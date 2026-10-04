/* JARVIS INTELLIGENCE — widget injetado pela bridge em /dashboard (o HTML original não é alterado). */
(() => {
  if (document.getElementById('jarvis-intel')) return
  const css = `#jarvis-intel{position:fixed;right:16px;bottom:16px;width:300px;max-height:70vh;overflow:auto;z-index:2147483000;
  font:12px/1.4 'Segoe UI',system-ui,sans-serif;color:#bfefff;background:rgba(2,10,16,.92);border:1px solid #0ae;border-radius:10px;
  box-shadow:0 0 24px rgba(0,200,255,.25);padding:12px;backdrop-filter:blur(6px)}
  #jarvis-intel h4{margin:0 0 6px;font-size:11px;letter-spacing:.22em;color:#5fe3ff;font-weight:600}
  #jarvis-intel .on{color:#4dffb0}#jarvis-intel .off{color:#ff6b6b}#jarvis-intel .row{display:flex;justify-content:space-between;padding:2px 0}
  #jarvis-intel .al{margin:6px 0;padding:6px 8px;border-left:2px solid #0ae;background:rgba(0,170,255,.07)}
  #jarvis-intel .min{cursor:pointer;float:right;color:#5fe3ff}#jarvis-intel small{color:#7fb7c7}`
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)
  const box = document.createElement('div'); box.id = 'jarvis-intel'; document.body.appendChild(box)
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const row = (n, ok) => `<div class="row"><span>${n}</span><b class="${ok ? 'on' : 'off'}">${ok ? 'ONLINE' : 'OFFLINE'}</b></div>`
  async function tick() {
    let s = null, i = null
    try { s = await (await fetch('/jarvis/status')).json() } catch { /* bridge off */ }
    try { i = await (await fetch('/jarvis/insight')).json() } catch { /* idem */ }
    const voice = 'speechSynthesis' in window && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)
    const up = Boolean(s)
    let html = `<span class="min" onclick="this.parentNode.querySelector('.body').hidden^=1">▾</span><h4>JARVIS INTELLIGENCE</h4>
      <div class="${up ? 'on' : 'off'}"><b>● SYSTEM ${up ? 'ONLINE' : 'OFFLINE'}</b></div><div class="body">
      ${row('Claude', s?.claude)}${row('Voice', voice)}${row('Bridge', up)}${row('Dashboard', up && s.dashboard)}${row('MCP', up && s.mcp)}
      <h4 style="margin-top:10px">JARVIS INSIGHT</h4>`
    if (!i || !i.available) html += `<div class="al">Não tenho esse dado disponível.<br><small>${esc(i?.hint ?? 'Bridge offline.')}</small></div>`
    else if (!i.alertas.length) html += `<div class="al"><small>Sem alertas para os dados atuais.</small></div>`
    else html += i.alertas.map((a) => `<div class="al"><b>${esc(a.label)}</b><br><small>${esc(a.why)}</small></div>`).join('')
    box.innerHTML = html + '</div>'
  }
  tick(); setInterval(tick, 15000)
})()
