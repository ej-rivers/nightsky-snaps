import fs from "fs";
import path from "path";

const root = process.cwd();
const outDir = path.join(root, "dist");
const pubDir = path.join(root, "public");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "config", "config.json"), "utf8"));
const affiliateCfg = JSON.parse(fs.readFileSync(path.join(root, "config", "affiliate.json"), "utf8"));

const site = {
  title: cfg.siteTitle || "NightSky Snaps — APOD Companion",
  desc: cfg.siteDescription || "",
  url: String(cfg.siteUrl || "").replace(/\/$/, ""),
  nasaKey: cfg.nasaApiKey || "DEMO_KEY",
  amazonTag: (cfg.affiliate && cfg.affiliate.amazonTag) || ""
};

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }
function writeFile(p, c){ ensureDir(path.dirname(p)); fs.writeFileSync(p, c); }
function iso(d){ return d.toISOString().slice(0,10); }
function fmtDate(isoStr){ const d = new Date(isoStr+"T00:00:00Z"); return d.toUTCString().slice(0,16); }
function esc(s){ return String(s||"").replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

function withAmazonTag(url, tag) {
  if (!url || !/amazon\./i.test(url) || !tag) return url;
  if (url.includes("tag=")) return url.replace(/tag=[^&]+/, "tag=" + tag);
  return url + (url.includes("?") ? "&" : "?") + "tag=" + tag;
}
function gearListHtml() {
  const items = (affiliateCfg.products||[]).map(p => {
    let url = p.url || "";
    url = withAmazonTag(url, site.amazonTag);
    return `<li><a rel="sponsored noreferrer" target="_blank" href="${esc(url)}">${esc(p.title||"Recommended item")}</a></li>`;
  });
  return `<ul>\n${items.join("\n")}\n</ul>`;
}

async function fetchApodRange(startIso, endIso){
  const url = `https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(site.nasaKey)}&start_date=${startIso}&end_date=${endIso}&thumbs=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("APOD fetch failed: " + res.status);
  const data = await res.json();
  return Array.isArray(data) ? data : [data];
}

/* Video thumbnail helpers */
function getYouTubeId(u) {
  if (!u) return "";
  const m =
    u.match(/[?&]v=([^&]+)/) ||
    u.match(/youtu\.be\/([^?&/]+)/) ||
    u.match(/youtube\.com\/embed\/([^?&/]+)/) ||
    u.match(/youtube\.com\/shorts\/([^?&/]+)/);
  return m ? m[1] : "";
}
function youTubeThumb(u) {
  const id = getYouTubeId(u);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
}
async function resolveVideoThumb(u) {
  if (!u) return "";
  try {
    if (/youtu\.?be/i.test(u)) {
      const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(u)}&format=json`);
      if (r.ok) {
        const j = await r.json();
        if (j && j.thumbnail_url) return j.thumbnail_url;
      }
      const yt = youTubeThumb(u);
      if (yt) return yt;
    } else if (/vimeo\.com/i.test(u)) {
      const r = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}`);
      if (r.ok) {
        const j = await r.json();
        if (j && j.thumbnail_url) return j.thumbnail_url;
      }
    }
  } catch { /* ignore */ }
  return "";
}

function pageTemplate({title, date, mediaHtml, explanation, urlPath}){
  const pageUrl = site.url + urlPath;
  const desc = (explanation || "").slice(0, 155);
  const adBlock = fs.readFileSync(path.join(root,'src','templates','partials','ad.html'),'utf8');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} — NightSky Snaps</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${esc(pageUrl)}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${esc(pageUrl)}" />
  <link rel="stylesheet" href="${site.url}/styles.css" />
</head>
<body>
  <header class="header">
    <div>
      <div class="brand"><a href="${site.url}/">NightSky Snaps</a></div>
      <div class="desc">APOD with context, archive, and gear picks</div>
    </div>
    <nav class="small">
  <a href="${site.url}/feed.xml">RSS</a> ·
  <a href="${site.url}/store.html">Store</a> ·
  <a href="${site.url}/donate.html">Donate</a>
</nav>
  </header>

  <main class="page">
    <h1>${esc(title)}</h1>
    <div class="small">${esc(fmtDate(date))}</div>
    <div style="margin:14px 0">${mediaHtml}</div>

    <section class="flex" style="margin-top:18px">
      <div class="panel">
        <h2 class="h2">Recommended Gear</h2>
        <p class="small">Curated picks for tonight's sky (affiliate links).</p>
        ${gearListHtml()}
      </div>
      ${adBlock}
    </section>

    <div style="margin-top:18px" class="note small">Source: <a href="https://apod.nasa.gov/">NASA APOD</a>. Using NASA API with attribution. Check individual media licensing on APOD.</div>
  </main>

  <footer class="footer small">© ${new Date().getFullYear()} NightSky Snaps · <a href="${site.url}/about.html">About</a> · <a href="${site.url}/privacy.html">Privacy</a> · <a href="${site.url}/sitemap.xml">Sitemap</a></footer>
</body>
</html>`;
}

function indexTemplate(items){
  const cards = items.map(it => {
    const thumb = it.media_type === "video"
      ? (it.thumbnail_url || youTubeThumb(it.url) || `${site.url}/video-placeholder.svg`)
      : (it.url || "");
    const p = `/apod/${it.date.replace(/-/g,"/")}.html`;
    return `<article class="card">
      <a href="${site.url}${p}"><img loading="lazy" src="${esc(thumb)}" alt="${esc(it.title)}" /></a>
      <div class="body">
        <h3><a href="${site.url}${p}">${esc(it.title)}</a></h3>
        <div class="meta">${esc(fmtDate(it.date))} • ${esc((it.media_type||"").toUpperCase())}</div>
      </div>
    </article>`;
  }).join("\n");

  const desc = site.desc;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(site.title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${esc(site.url)}/" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(site.title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${esc(site.url)}/" />
  <link rel="stylesheet" href="${site.url}/styles.css" />
</head>
<body>
  <header class="header">
    <div>
      <div class="brand"><a href="${site.url}/">NightSky Snaps</a></div>
      <div class="desc">APOD with context, archive, and gear picks</div>
    </div>
    <nav class="small">
  <a href="${site.url}/feed.xml">RSS</a> ·
  <a href="${site.url}/store.html">Store</a> ·
  <a href="${site.url}/donate.html">Donate</a>
</nav>
  </header>
  <main class="container">
    <div class="grid">${cards}</div>
  </main>
  <footer class="footer small">© ${new Date().getFullYear()} NightSky Snaps · <a href="${site.url}/about.html">About</a> · <a href="${site.url}/privacy.html">Privacy</a> · <a href="${site.url}/sitemap.xml">Sitemap</a></footer>
</body>
</html>`;
}

function rssTemplate(items){
  const siteUrl = site.url;
  const rssItems = items.slice(0, 30).map(it => {
    const p = `/apod/${it.date.replace(/-/g,"/")}.html`;
    const link = siteUrl + p;
    const desc = esc((it.explanation||"").slice(0, 500));
    return `<item>
  <title>${esc(it.title)}</title>
  <link>${esc(link)}</link>
  <guid>${esc(link)}</guid>
  <pubDate>${new Date(it.date+"T00:00:00Z").toUTCString()}</pubDate>
  <description>${desc}</description>
</item>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${esc(site.title)}</title>
  <link>${esc(siteUrl)}</link>
  <description>${esc(site.desc)}</description>
  ${rssItems}
</channel>
</rss>`;
}

function sitemapTemplate(items){
  const urls = items.map(it => `${site.url}/apod/${it.date.replace(/-/g,"/")}.html`);
  const all = [site.url+'/', site.url+'/feed.xml', ...urls];
  const xml = all.map(u => `<url><loc>${esc(u)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${xml}
</urlset>`;
}

(async () => {
  ensureDir(outDir);
  if (fs.existsSync(pubDir)) fs.cpSync(pubDir, outDir, { recursive: true });

  // Fetch last 14 days
  const now = new Date();
  const start = new Date(now.getTime() - 13*24*3600*1000);
  let apods = [];
  try {
    apods = await fetchApodRange(iso(start), iso(now));
  } catch (e) {
    console.error("APOD fetch error:", e.message || e);
  }
  apods = (apods||[]).filter(x => x && x.date && (x.url || x.thumbnail_url));

  // Fill in missing video thumbnails
  for (const it of apods) {
    if (it.media_type === "video" && !it.thumbnail_url) {
      it.thumbnail_url = await resolveVideoThumb(it.url || "") || youTubeThumb(it.url || "");
    }
  }

  apods.sort((a,b)=> (a.date < b.date ? 1 : -1));

  // Per-day pages
  for (const it of apods) {
    const date = it.date;
    const p = `/apod/${date.replace(/-/g,"/")}.html`;
    let mediaHtml = "";
    if (it.media_type === "image") {
      const imgSrc = it.hdurl || it.url || "";
      mediaHtml = `<img class="hero" src="${esc(imgSrc)}" alt="${esc(it.title)}" />`;
    } else if (it.media_type === "video") {
      const src = it.url || "";
      if (/youtube\.com|youtu\.be/.test(src)) {
        const id = getYouTubeId(src);
        const embed = id ? `https://www.youtube.com/embed/${id}` : src;
        mediaHtml = `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px;border:1px solid rgba(255,255,255,.08)"><iframe src="${esc(embed)}" frameborder="0" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe></div>`;
      } else {
        mediaHtml = `<a class="badge" href="${esc(src)}" target="_blank" rel="noopener">View Video</a>`;
      }
    }
    const html = pageTemplate({ title: it.title || "APOD", date, mediaHtml, explanation: it.explanation || "", urlPath: p });
    writeFile(path.join(outDir, p), html);
  }

  // Index, RSS, sitemap
  writeFile(path.join(outDir, "index.html"), indexTemplate(apods));
  writeFile(path.join(outDir, "feed.xml"), rssTemplate(apods));
  writeFile(path.join(outDir, "sitemap.xml"), sitemapTemplate(apods));
})();
