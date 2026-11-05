/* Settings dashboard; no cloud requests or appliance credentials. */
function initializeWashStatistics(Homey) {
  const $ = id => document.getElementById(id);
  const t = key => Homey.__('statistics.' + key);
  let devices = [], timeZone = 'UTC', page = 0, request = 0;
  const size = 20;
  function node(tag, value, className) {
    const el = document.createElement(tag);
    if (value != null) el.textContent = value;
    if (className) el.className = className;
    return el;
  }
  function option(select, value, label) {
    const item = node('option', label); item.value = value; select.appendChild(item);
  }
  function monthKey(date) {
    const parts = new Intl.DateTimeFormat('en', {timeZone, year:'numeric', month:'2-digit'}).formatToParts(date);
    return parts.find(p => p.type === 'year').value + '-' + parts.find(p => p.type === 'month').value;
  }
  function dateLabel(iso) {
    return new Intl.DateTimeFormat(undefined, {timeZone, dateStyle:'medium', timeStyle:'short'}).format(new Date(iso));
  }
  const pretty = value => value ? value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2') : t('unknown_value');
  function temperature(value) {
    if (value === 'Cold') return t('cold');
    const n = value && value.match(/\d+/);
    return n ? n[0] + ' °C' : pretty(value);
  }
  function spin(value) {
    if (value === 'Off') return t('off');
    const n = value && value.match(/\d+/);
    return n ? n[0] + ' rpm' : pretty(value);
  }
  function most(counts, format) {
    const first = Object.entries(counts).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]))[0];
    return first ? format(first[0]) : '—';
  }
  function selected() { return devices.find(d => d.id === $('stats-device').value); }
  function matches(iso, period) {
    const month = monthKey(new Date(iso));
    return period === 'all' || month === period || month.startsWith(period + '-');
  }
  function totals(stats, period) {
    if (period === 'all') return stats.totals;
    const result = {completed:0, aborted:0, unknown:0, durationMinutes:0, timedCycles:0,
      speedPerfect:0, programs:{}, temperatures:{}, spinSpeeds:{}};
    Object.entries(stats.months).forEach(([key, value]) => {
      if (key !== period && !key.startsWith(period + '-')) return;
      ['completed','aborted','unknown','durationMinutes','timedCycles','speedPerfect'].forEach(k => result[k] += value[k]);
      ['programs','temperatures','spinSpeeds'].forEach(k => {
        Object.entries(value[k]).forEach(([name,count]) => result[k][name] = (result[k][name] || 0) + count);
      });
    });
    return result;
  }
  function periods() {
    const stats = selected()?.statistics;
    const select = $('stats-period'), previous = select.value;
    select.replaceChildren();
    option(select, 'all', t('all_time'));
    if (!stats) return;
    const months = [...new Set([...Object.keys(stats.months), monthKey(new Date())])].sort().reverse();
    [...new Set(months.map(m => m.slice(0,4)))].forEach(year => {
      option(select, year, year);
      months.filter(m => m.startsWith(year)).forEach(month => {
        option(select, month, new Intl.DateTimeFormat(undefined, {timeZone:'UTC', month:'long',year:'numeric'}).format(new Date(month + '-15T12:00:00Z')));
      });
    });
    if ([...select.options].some(o => o.value === previous)) select.value = previous;
  }
  function render() {
    const stats = selected()?.statistics;
    $('stats-content').hidden = !stats;
    if (!stats) return;
    const period = $('stats-period').value, summary = totals(stats, period);
    $('stats-since').textContent = t('since') + ' ' + dateLabel(stats.trackingSince);
    $('stats-active').textContent = stats.active ? t('in_progress') + ': ' + pretty(stats.active.program) : '';
    const cards = $('stats-cards');
    cards.replaceChildren();
    [
      [t('completed'), summary.completed], [t('aborted'), summary.aborted], [t('unknown'), summary.unknown],
      [t('favorite'), most(summary.programs, pretty)],
      [t('temperature'), most(summary.temperatures, temperature)],
      [t('spin'), most(summary.spinSpeeds, spin)],
      [t('average'), summary.timedCycles ? Math.round(summary.durationMinutes / summary.timedCycles) + ' min' : '—'],
      [t('speed'), summary.speedPerfect],
    ].forEach(([label,value]) => {
      const card = node('div', null, 'stats-card');
      card.append(node('div', label, 'muted'), node('strong', value)); cards.appendChild(card);
    });
    const chart = $('stats-chart'); chart.replaceChildren();
    const current = monthKey(new Date());
    const end = period === 'all' ? current : period.slice(0,4) + '-12';
    const endDate = new Date(end + '-15T12:00:00Z');
    const entries = Array.from({length:12}, (_,i) => {
      const d = new Date(endDate); d.setUTCMonth(d.getUTCMonth() - 11 + i);
      const key = d.toISOString().slice(0,7);
      const label = new Intl.DateTimeFormat(undefined, {timeZone:'UTC', month:'short',year:'numeric'}).format(d);
      return [label, stats.months[key]?.completed || 0];
    });
    const max = Math.max(1,...entries.map(e => e[1]));
    entries.forEach(([label,count]) => {
      const row = node('div',null,'stats-bar-row');
      const track = node('div',null,'stats-bar-track');
      const fill = node('div',null,'stats-bar'); fill.style.width = (count / max * 100) + '%';
      track.appendChild(fill); track.setAttribute('aria-hidden','true');
      row.append(node('span',label),track,node('strong',count)); chart.appendChild(row);
    });
    const ranking = $('stats-programs'); ranking.replaceChildren();
    const ranked = Object.entries(summary.programs).sort((a,b) => b[1]-a[1]);
    if (!ranked.length) ranking.appendChild(node('p',t('empty'), 'muted'));
    ranked.forEach(([program,count]) => {
      const row = node('div',null,'stats-ranking-row');
      row.append(node('span',pretty(program)),node('strong',count + ' · ' + Math.round(count / summary.completed * 100) + '%'));
      ranking.appendChild(row);
    });
    const history = stats.history.filter(c => matches(c.endedAt,period));
    page = Math.min(page,Math.max(0,Math.ceil(history.length/size)-1));
    const body = $('stats-history'); body.replaceChildren();
    history.slice(page*size,(page+1)*size).forEach(cycle => {
      const row = node('tr');
      const result = t(cycle.outcome) + (cycle.partial ? ' · ' + t('partial') : '');
      [dateLabel(cycle.endedAt), pretty(cycle.program), temperature(cycle.temperature),
        spin(cycle.spinSpeed),cycle.durationMinutes == null ? '—' : cycle.durationMinutes + ' min',result]
        .forEach(value => row.appendChild(node('td',value)));
      body.appendChild(row);
    });
    $('stats-empty-history').hidden = history.length > 0;
    $('stats-page').textContent = (page+1) + ' / ' + Math.max(1,Math.ceil(history.length/size));
    $('stats-prev').disabled = page === 0;
    $('stats-next').disabled = (page+1)*size >= history.length;
  }
  async function refresh() {
    const token = ++request;
    $('stats-refresh').disabled = true;
    $('stats-message').textContent = t('loading');
    try {
      const data = await new Promise((resolve,reject) => Homey.api('GET','/statistics',{},(err,res) => err ? reject(err) : resolve(res)));
      if (token !== request) return;
      const previous = $('stats-device').value;
      devices = data.devices.filter(d => d.statistics?.version === 1);
      timeZone = data.timeZone;
      $('stats-device').replaceChildren();
      devices.forEach(d => option($('stats-device'),d.id,d.name));
      if (devices.some(d => d.id === previous)) $('stats-device').value = previous;
      $('stats-controls').hidden = !devices.length;
      $('stats-message').textContent = devices.length ? '' : t('no_devices');
      periods(); render();
    } catch (err) {
      if (token !== request) return;
      $('stats-message').textContent = t('load_failed') + ': ' + (err.message || String(err));
      $('stats-content').hidden = true;
    } finally { if (token === request) $('stats-refresh').disabled = false; }
  }
  $('stats-device').addEventListener('change',() => { page=0; periods(); render(); });
  $('stats-period').addEventListener('change',() => { page=0; render(); });
  $('stats-refresh').addEventListener('click',refresh);
  $('stats-prev').addEventListener('click',() => { page--; render(); });
  $('stats-next').addEventListener('click',() => { page++; render(); });
  document.querySelector('[data-tab="statistics"]').addEventListener('click',refresh);
}
