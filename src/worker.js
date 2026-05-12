/**
 * Cloudflare Worker - NetEase Music Unlock
 * 
 * 解锁网易云音乐海外播放限制 & 自动刷新登录 Token
 * 
 * Features:
 * - 代理请求并添加 X-Real-IP 伪装国内 IP
 * - 自动将音频 CDN 切换到国内节点 (m*c.music.126.net)
 * - 定时任务自动刷新登录 Token，保持 Cookie 有效
 */

const TARGET_HOSTS = new Set(['music.163.com', 'music.126.net'])
const REAL_IP = '211.161.244.70'

const buildCookie = env => {
  if (env.NETEASE_COOKIE && env.NETEASE_COOKIE.trim()) return env.NETEASE_COOKIE.trim()
  if (env.MUSIC_U && env.MUSIC_U.trim()) return `MUSIC_U=${env.MUSIC_U.trim()}`
  return ''
}

const buildHeaders = (targetUrl, env, extraHeaders = {}) => {
  const headers = new Headers(extraHeaders)
  headers.set('Host', targetUrl.hostname)
  headers.set('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

  const cookie = buildCookie(env)
  if (cookie) headers.set('Cookie', cookie)

  if (targetUrl.hostname === 'music.163.com') {
    headers.set('X-Real-IP', REAL_IP)
  }

  if (targetUrl.hostname === 'music.126.net' && /m\d+c/.test(targetUrl.hostname + targetUrl.pathname)) {
    headers.set('Cache-Control', 'no-cache')
  }

  return headers
}

const fetchNetease = async (targetUrl, request, env) => {
  const headers = buildHeaders(targetUrl, env, request?.headers || {})

  return fetch(targetUrl.toString(), {
    method: request?.method || 'GET',
    headers,
    body: request?.body,
    redirect: 'manual'
  })
}

const fetchNeteasePost = async (targetUrl, env, body = null) => {
  const headers = buildHeaders(targetUrl, env)
  if (body) {
    headers.set('Content-Type', 'application/x-www-form-urlencoded')
  }

  return fetch(targetUrl.toString(), {
    method: 'POST',
    headers,
    body,
    redirect: 'manual'
  })
}

const rewriteEnhancePlayerUrl = async upstream => {
  const text = await upstream.text()
  try {
    const data = JSON.parse(text)
    if (data && Array.isArray(data.data)) {
      data.data.forEach(song => {
        if (song && typeof song.url === 'string') {
          song.url = song.url.replace(/(m\d+?)(?!c)\.music\.126\.net/, '$1c.music.126.net')
        }
      })
    }
    return JSON.stringify(data)
  } catch (_) {
    return text
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // 根路径显示状态
    if (url.pathname === '/' || url.pathname === '') {
      const cookie = buildCookie(env)
      return new Response(JSON.stringify({
        status: 'ok',
        name: 'NetEase Music Unlock Worker',
        cookie_configured: !!cookie,
        usage: '/proxy/https/music.163.com/path...'
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Expect path like: /proxy/https/music.163.com/...
    if (!url.pathname.startsWith('/proxy/')) {
      return new Response('Not Found', { status: 404 })
    }

    // 解析目标 URL: /proxy/https/music.163.com/path -> https://music.163.com/path
    const pathAfterProxy = url.pathname.slice('/proxy/'.length)
    const slashIndex = pathAfterProxy.indexOf('/')
    if (slashIndex === -1) {
      return new Response('Bad Request: invalid path', { status: 400 })
    }
    const protocol = pathAfterProxy.slice(0, slashIndex)
    const rest = pathAfterProxy.slice(slashIndex + 1)
    const targetUrlStr = `${protocol}://${rest}${url.search}`

    let targetUrl
    try {
      targetUrl = new URL(targetUrlStr)
    } catch (_) {
      return new Response('Bad Request: invalid URL', { status: 400 })
    }

    if (!TARGET_HOSTS.has(targetUrl.hostname)) {
      return new Response('Forbidden', { status: 403 })
    }

    const upstream = await fetchNetease(targetUrl, request, env)
    const respHeaders = new Headers(upstream.headers)

    // CORS: allow browser to call the worker directly
    respHeaders.set('Access-Control-Allow-Origin', '*')
    respHeaders.set('Access-Control-Allow-Headers', '*')
    respHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: respHeaders })
    }

    const isEnhancePlayerUrl =
      targetUrl.hostname === 'music.163.com' &&
      targetUrl.pathname.includes('enhance/player/url')

    if (isEnhancePlayerUrl) {
      const body = await rewriteEnhancePlayerUrl(upstream)
      return new Response(body, { status: upstream.status, headers: respHeaders })
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders
    })
  },

  async scheduled(event, env, ctx) {
    const cookie = buildCookie(env)
    if (!cookie) {
      console.log('[cron] missing NETEASE_COOKIE or MUSIC_U')
      return
    }

    console.log('[cron] start at', new Date().toISOString())

    // 1. 验证登录状态 - 获取排行榜
    const verifyUrl = new URL('https://music.163.com/discover/toplist')
    const verifyResp = await fetchNetease(verifyUrl, null, env)
    const verifyText = await verifyResp.text()
    
    // 检查是否包含歌曲列表数据
    const hasSongList = verifyText.includes('song-list-pre-data')
    console.log('[cron] verify login:', verifyResp.status, hasSongList ? 'OK' : 'FAILED')
    
    if (!hasSongList) {
      console.log('[cron] login verification failed, cookie may be expired')
      return
    }

    // 2. 刷新 token - POST 请求
    const refreshUrl = new URL('https://music.163.com/weapi/login/token/refresh')
    const refreshResp = await fetchNeteasePost(refreshUrl, env)
    const refreshText = await refreshResp.text()
    console.log('[cron] refresh token:', refreshResp.status, refreshText.slice(0, 200))

    // 3. 可选：执行自定义 URL 列表
    const cronUrls = (env.CRON_URLS || '').split(',').map(s => s.trim()).filter(Boolean)
    for (const entry of cronUrls) {
      // 支持格式: "POST https://..." 或 "https://..."（默认GET）
      const parts = entry.split(' ')
      let method = 'GET', urlStr = entry
      if (parts.length >= 2 && ['GET', 'POST'].includes(parts[0].toUpperCase())) {
        method = parts[0].toUpperCase()
        urlStr = parts.slice(1).join(' ')
      }

      let targetUrl
      try {
        targetUrl = new URL(urlStr)
      } catch (_) {
        console.log('[cron] invalid url', urlStr)
        continue
      }

      if (!TARGET_HOSTS.has(targetUrl.hostname)) {
        console.log('[cron] forbidden host', targetUrl.hostname)
        continue
      }

      const upstream = method === 'POST'
        ? await fetchNeteasePost(targetUrl, env)
        : await fetchNetease(targetUrl, null, env)
      
      console.log('[cron]', method, targetUrl.toString(), upstream.status)
    }

    console.log('[cron] done at', new Date().toISOString())
  }
}

