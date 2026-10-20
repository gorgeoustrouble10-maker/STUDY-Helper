export const dynamic = 'force-dynamic';
// RSS 订阅源的人话视图：浏览器直接访问 /rss.xml 时套用本样式，
// 展示订阅说明与已发布条目；RSS 阅读器解析 XML 本身，不受影响。
const xsl = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8"/>
  <xsl:template match="/rss">
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="channel/title"/> · RSS 订阅源</title>
        <style>
          body { margin: 0; background: #faf9f6; color: #2c2a26; font: 16px/1.7 Georgia, 'Songti SC', 'SimSun', serif; }
          main { max-width: 640px; margin: 0 auto; padding: 48px 20px 64px; }
          .badge { display: inline-block; font: 12px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .1em; color: #8a857b; border: 1px solid #ddd8ce; border-radius: 999px; padding: 5px 12px; margin: 0 0 20px; }
          h1 { font-size: 26px; margin: 0 0 6px; }
          .tagline { color: #6f6a60; margin: 0 0 28px; }
          .hint { background: #f1efe9; border-radius: 10px; padding: 14px 16px; font-size: 14px; color: #55504a; }
          .hint code { font: 13px/1.4 Consolas, monospace; background: #fff; border: 1px solid #ddd8ce; border-radius: 5px; padding: 2px 6px; }
          .empty { color: #6f6a60; border: 1px dashed #d8d2c6; border-radius: 10px; padding: 22px; text-align: center; margin-top: 28px; }
          ul { list-style: none; margin: 28px 0 0; padding: 0; }
          li { border-bottom: 1px solid #e7e2d8; padding: 18px 0; }
          li a { color: #2c2a26; font-weight: 600; text-decoration: none; }
          li a:hover { text-decoration: underline; }
          .date { display: block; font: 12px/1.6 ui-sans-serif, system-ui, sans-serif; color: #8a857b; margin-top: 2px; }
          li p { color: #55504a; font-size: 14px; margin: 8px 0 0; }
          footer { margin-top: 40px; font-size: 13px; color: #8a857b; }
          footer a { color: inherit; }
        </style>
      </head>
      <body>
        <main>
          <p class="badge">RSS 订阅源</p>
          <h1><xsl:value-of select="channel/title"/></h1>
          <p class="tagline"><xsl:value-of select="channel/description"/></p>
          <p class="hint">把订阅地址 <code><xsl:value-of select="channel/link"/>/rss.xml</code> 添加到 RSS 阅读器（如 Folo、Feedly、NetNewsWire），新发布的内容会自动送达，无需频繁打开网站。</p>
          <xsl:choose>
            <xsl:when test="count(channel/item) = 0">
              <p class="empty">订阅源工作正常，站点还没有已发布的内容。发布第一篇后，它会出现在这里。</p>
            </xsl:when>
            <xsl:otherwise>
              <ul>
                <xsl:for-each select="channel/item">
                  <li>
                    <a href="{link}"><xsl:value-of select="title"/></a>
                    <span class="date"><xsl:value-of select="pubDate"/></span>
                    <p><xsl:value-of select="description"/></p>
                  </li>
                </xsl:for-each>
              </ul>
            </xsl:otherwise>
          </xsl:choose>
          <footer>本页面是订阅源的浏览器视图；<a href="{channel/link}">返回站点 ↗</a></footer>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>`;
export async function GET() { return new Response(xsl, { headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' } }); }
