const h = { preamp: 1, opus: 1.2, bitrate: 510, exciter: 0, stereo: false, wider: false, haas: false };
let p = 0; 

try {
  chrome.storage.local.get(['elixir_settings'], (result) => {
    if (result && result.elixir_settings) {
      Object.assign(h, result.elixir_settings);
    }
    initUI();
    logMessage("System initialized successfully.");
  });
} catch (e) {
  initUI();
  logMessage("Initialized in fallback mode.");
}

function logMessage(text) {
  const logContainer = document.getElementById("elixir-log-content");
  if (logContainer) {
    const time = new Date().toLocaleTimeString();
    logContainer.innerHTML += `<div>[${time}] ${text}</div>`;
    logContainer.scrollTop = logContainer.scrollHeight;
  }
}

function saveAndSync() {
  try {
    chrome.storage.local.set({ elixir_settings: h });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'UPDATE_SETTINGS', settings: h }).catch(() => {});
      }
    });
  } catch (e) {}
}

const ae = [
  {title:"121 SET",controls:[{type:"slider",key:"preamp",name:"PREAMP",min:1,max:500,step:.1,fmt:t=>`${Number(t).toFixed(1)}x`},{type:"slider",key:"opus",name:"GAIN",min:1,max:5e4,step:.1,fmt:t=>`${Number(t).toFixed(1)}×`},{type:"slider",key:"bitrate",name:"BITRATE",min:0,max:510,step:1,fmt:t=>`${t} kbps`},{type:"slider",key:"exciter",name:"EXCITER",min:0,max:500,step:1,fmt:t=>`${Math.round(t)}%`}]},
  {title:"STEREO LOG",controls:[{type:"toggle",key:"stereo",name:"STEREO",sub:"IN-HEAD"},{type:"toggle",key:"wider",name:"WIDER"},{type:"toggle",key:"haas",name:"QUICK HAAS"}],monitor:!0}
];

document.addEventListener("DOMContentLoaded", () => {
  initUI();
});

function initUI() {
  const e = document.querySelector(".elixir-tabs"),
        n = document.querySelector(".elixir-body");
  
  if (!e || !n) return;

  e.innerHTML = "";
  ae.forEach((item, r) => {
    const y = document.createElement("button");
    y.className = "elixir-tab" + (r === p ? " on" : "");
    y.textContent = item.title;
    y.onclick = () => {
      p = r;
      e.querySelectorAll(".elixir-tab").forEach((O, E) => O.classList.toggle("on", E === r));
      renderBody();
      logMessage(`Switched tab to: ${item.title}`);
    };
    e.appendChild(y);
  });

  const resetBtn = document.querySelector(".elixir-reset");
  if (resetBtn) {
    resetBtn.onclick = () => {
      h.preamp = 1; h.opus = 1.2; h.bitrate = 510; h.exciter = 0; h.stereo = false; h.wider = false; h.haas = false;
      saveAndSync();
      renderBody();
      logMessage("Settings reset to default.");
    };
  }

  renderBody();
}

function renderBody() {
  const n = document.querySelector(".elixir-body");
  if (!n) return;
  n.innerHTML = "";
  const i = ae[p];
  if (!i || !i.controls) return;
  
  i.controls.forEach(r => {
    n.appendChild(r.type === "toggle" ? v(r) : M(r));
  });

  // নতুন টার্মিনাল স্টাইল কনসোল বোর্ড [121 SET] ট্যাবের নিচে
  if (p === 0) {
    const consoleBox = document.createElement("div");
    consoleBox.className = "elixir-console";
    consoleBox.innerHTML = `
      <div class="elixir-console-topbar">
        <div class="elixir-console-dots">
          <span class="elixir-console-dot red"></span>
          <span class="elixir-console-dot yellow"></span>
          <span class="elixir-console-dot green"></span>
        </div>
        <span class="elixir-console-title">ELIXIR V1 // TERMINAL</span>
      </div>
      <div id="elixir-log-content" class="elixir-console-logs">
        <div>[System] Elixir V1 core online.</div>
      </div>
    `;
    n.appendChild(consoleBox);
  }

  // STEREO LOG ট্যাবের জন্য মনিটর মিটার
  if (i.monitor) {
    const r = document.createElement("div");
    r.className = "elixir-monitor";
    r.innerHTML = `
        <div class="elixir-line"><span class="elixir-name">VOICE POSITION</span><span class="elixir-val" id="elixir-pos">IDLE</span></div>
        <div class="elixir-reticle">
          <div class="elixir-grid"></div>
          <div class="elixir-ring r3"></div>
          <div class="elixir-ring r2"></div>
          <div class="elixir-ring r1"></div>
          <div class="elixir-sweep"></div>
          <div class="elixir-crosshair"></div>
          <span class="elixir-corner tl"></span><span class="elixir-corner tr"></span>
          <span class="elixir-corner bl"></span><span class="elixir-corner br"></span>
          <span class="elixir-lbl lf">L</span><span class="elixir-lbl rt">R</span>
          <span class="elixir-lbl tp">FRONT</span><span class="elixir-lbl bt">BACK</span>
          <div class="elixir-head-dot"></div>
        </div>
        <div class="elixir-meters">
          <div class="elixir-meter"><span>L</span><i><b id="elixir-mL" style="width: 35%;"></b></i></div>
          <div class="elixir-meter"><span>R</span><i><b id="elixir-mR" style="width: 35%;"></b></i></div>
        </div>`;
    n.appendChild(r);
  }
}

function M(i) {
  const r = document.createElement("div");
  r.className = "elixir-row";
  r.innerHTML = `
      <div class="elixir-line">
        <span class="elixir-name">${i.name}</span>
        <span class="elixir-val">${i.fmt(h[i.key] !== undefined ? h[i.key] : i.min)}</span>
      </div>
      <input type="range" min="${i.min}" max="${i.max}" step="${i.step}" value="${h[i.key] !== undefined ? h[i.key] : i.min}" />`;
  const y = r.querySelector("input"),
        O = r.querySelector(".elixir-val"),
        E = () => y.style.setProperty("--p", ((y.value - i.min) / (i.max - i.min)) * 100 + "%");
  E();
  y.addEventListener("input", () => {
    h[i.key] = Number(y.value);
    O.textContent = i.fmt(h[i.key]);
    E();
    saveAndSync();
    logMessage(`${i.name} -> ${h[i.key]}`);
  });
  return r;
}

function v(i) {
  const r = document.createElement("div");
  r.className = "elixir-row elixir-toggle-row";
  r.innerHTML = `
      <span class="elixir-tname"><span class="elixir-name">${i.name}</span><span class="elixir-subname">${i.sub||""}</span></span>
      <button type="button" class="elixir-switch" role="switch" aria-checked="${!!h[i.key]}">
        <span class="elixir-knob"></span>
      </button>`;
  const y = r.querySelector(".elixir-switch");
  y.classList.toggle("on", !!h[i.key]);
  y.onclick = () => {
    h[i.key] = !h[i.key];
    y.classList.toggle("on", h[i.key]);
    y.setAttribute("aria-checked", h[i.key]);
    saveAndSync();
    logMessage(`${i.name} : ${h[i.key] ? 'ENABLED' : 'DISABLED'}`);
  };
  return r;
}
