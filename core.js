(()=>{if(window.__elixirV1)return;window.__elixirV1=!0;const U=(...t)=>console.log("[ELIXIR V1]",...t);U("injector loaded, waiting for mic requests...");const h={preamp:1,opus:1.2,bitrate:510,exciter:0,stereo:!1,wider:!1,haas:!1};

// পপআপ বা স্টোরেজ থেকে সেটিংস সিঙ্ক করার ব্যবস্থা
window.addEventListener("message", (e) => {
    if (e.data && e.data.type === 'ELIXIR_UPDATE') {
        Object.assign(h, e.data.settings);
        X();
    }
});

const oe=`
        class RevolutionaryProcessor extends AudioWorkletProcessor {
            constructor() {
                super();
                this._dcX = new Float32Array(8);
                this._dcY = new Float32Array(8);
                this._hpPrev = new Float32Array(8);
                this._hpOut = new Float32Array(8);
                this._rvbLens = [887, 1153, 1559, 1907, 2311, 2719, 3109, 3557];
                this._preDelayLen = 577;
                this._apLens = [241, 433];
                this._rvbBufs = [];
                this._rvbIdx = [];
                this._rvbLPState = [];
                this._preDelay = [];
                this._preIdx = [];
                this._apBufs = [];
                this._apIdx = [];
                this._rvbTmp = new Float64Array(8);

                for (let ch = 0; ch < 8; ch++) {
                    this._rvbBufs[ch] = this._rvbLens.map(l => new Float32Array(l));
                    this._rvbIdx[ch] = new Int32Array(8);
                    this._rvbLPState[ch] = new Float32Array(8);
                    this._preDelay[ch] = new Float32Array(this._preDelayLen);
                    this._preIdx[ch] = 0;
                    this._apBufs[ch] = this._apLens.map(l => new Float32Array(l));
                    this._apIdx[ch] = new Int32Array(2);
                }
            }
            static get parameterDescriptors() {
                return [
                    { name: 'gain', defaultValue: 1.0, minValue: 0, maxValue: 500 },
                    { name: 'rage', defaultValue: 0.0, minValue: 0, maxValue: 2000 },
                    { name: 'distort', defaultValue: 0.0, minValue: 0, maxValue: 500 },
                    { name: 'bitrate', defaultValue: 2500, minValue: 1, maxValue: 2500 },
                    { name: 'gate', defaultValue: 1.0, minValue: 0, maxValue: 50 },
                    { name: 'mute', defaultValue: 0, minValue: 0, maxValue: 1 },
                    { name: 'reverb', defaultValue: 0, minValue: 0, maxValue: 100 },
                ];
            }
            softClip(x, knee) {
                const abs = Math.abs(x);
                if (abs <= knee) return x;
                const sign = x > 0 ? 1 : -1;
                const excess = abs - knee;
                const headroom = 1.0 - knee;
                const compressed = headroom * (1.0 - Math.exp(-excess / (headroom * 0.55)));
                return sign * (knee + compressed);
            }
            process(inputs, outputs, params) {
                const input = inputs[0], output = outputs[0];
                if (!input || !input.length || !input[0].length) return true;
                const channelCount = input.length, frameLength = input[0].length;
                for (let i = 0; i < frameLength; i++) {
                    const gain = params.gain[i] || params.gain[0], bitrate = params.bitrate[i] || params.bitrate[0];
                    for (let ch = 0; ch < channelCount; ch++) {
                        let s = input[ch][i];
                        s *= gain;
                        output[ch][i] = this.softClip(s, 0.9);
                    }
                }
                return true;
            }
        }
        registerProcessor('revolutionary-processor', RevolutionaryProcessor);
    `, le=`
    class SmoothVoiceDSP extends AudioWorkletProcessor{
      constructor(){ super(); this.port.onmessage=e=>this.p={...this.p,...e.data}; }
      process(inputs,outputs){
        const i=inputs[0],o=outputs[0];
        if(!i||!i[0])return true;
        o[0].set(i[0]); if(o[1]) o[1].set(i[1]||i[0]);
        return true;
      }
    }
    registerProcessor("smooth-voice-dsp",SmoothVoiceDSP);
  `, ce=`
        class GodTierProcessor extends AudioWorkletProcessor {
            process(inputs, outputs) {
                const i = inputs[0], o = outputs[0];
                if(!i || !i[0]) return true;
                o[0].set(i[0]); if(o[1]) o[1].set(i[1]||i[0]);
                return true;
            }
        }
        registerProcessor('godtier-processor', GodTierProcessor);
    `, Z={}, j=(t,s)=>Z[t]||(Z[t]=URL.createObjectURL(new Blob([s],{type:"application/javascript"}))), pe={preamp:1,opus:1.2,bitrate:510,exciter:0,stereo:!1,wider:!1,haas:!1};let C=null,z=null,P=null,ee=null;
function de(){if(!P||P.state==="closed"){const t=window.AudioContext||window.webkitAudioContext;try{P=new t({latencyHint:"interactive",sampleRate:48e3})}catch{P=new t}ee=Promise.all([P.audioWorklet.addModule(j("sky",oe)),P.audioWorklet.addModule(j("fvck",le)),P.audioWorklet.addModule(j("p4ck",ce))])}return P}
const he=()=>{P&&P.state==="suspended"&&P.resume().catch(()=>{})};["click","touchstart","touchend","pointerdown","keydown","visibilitychange","focus"].forEach(t=>window.addEventListener(t,he,{passive:!0}));
function me(){if(C){try{C.source.disconnect()}catch{}["sky","fvck","p4ck"].forEach(t=>{try{C[t].disconnect()}catch{}}),C=null}}
async function ue(t){const s=de();s.state==="suspended"&&await s.resume().catch(()=>{}),await ee,me();const e=s.createMediaStreamSource(t),n=new AudioWorkletNode(s,"revolutionary-processor",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:"explicit",parameterData:{gain:h.preamp,rage:0,distort:0,bitrate:2500,gate:0,mute:0,reverb:0}}),p=new AudioWorkletNode(s,"smooth-voice-dsp",{outputChannelCount:[2]});p.port.postMessage({opus:h.opus,exc:h.exciter});const c=new AudioWorkletNode(s,"godtier-processor",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});c.channelCount=2,c.channelCountMode="explicit",c.channelInterpretation="discrete";const d=s.createMediaStreamDestination();d.channelCount=2;const f=s.createChannelSplitter(2),F=s.createAnalyser();F.fftSize=512;const M=s.createAnalyser();M.fftSize=512,e.connect(n),n.connect(p),p.connect(c),c.connect(d),c.connect(f),f.connect(F,0),f.connect(M,1);const v=d.stream.getAudioTracks()[0],_=t.getAudioTracks()[0];if(v&&_){v.enabled=!0;const i=v.stop.bind(v);v.stop=function(){try{_.stop()}catch{}i()},_.addEventListener("ended",()=>{try{v.stop()}catch{}})}return C={ctx:s,out:d,source:e,sky:n,fvck:p,p4ck:c,anL:F,anR:M,track:v},z=C,X(),U("mic captured, chain attached."),d.stream}
function X(){const t=C;if(t&&t.track&&t.track.readyState!=="ended"){const s=t.ctx.currentTime,e=.014;try{t.sky.parameters.get("gain").setTargetAtTime(h.preamp,s,e);t.fvck.port.postMessage({opus:h.opus,exc:h.exciter});const n=t.p4ck.parameters;n.get("wider").setTargetAtTime(h.wider?460:0,s,e);n.get("quickHaas").setTargetAtTime(h.haas?30:0,s,e);n.get("inHead").setTargetAtTime(h.stereo?1:0,s,e)}catch{}}}
if(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){const t=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async s=>{if(!s||!s.audio)return t(s);const e=s.audio,n={echoCancellation:!1,noiseSuppression:!1,autoGainControl:!1,channelCount:{ideal:2,min:1},googEchoCancellation:!1,googAutoGainControl:!1,googNoiseSuppression:!1,googHighpassFilter:!1};e&&typeof e=="object"&&e.deviceId&&(n.deviceId=e.deviceId);const p=await t({...s,audio:n});if(p.getAudioTracks().length===0)return p;try{const c=await ue(p),d=new MediaStream;return c.getAudioTracks().forEach(f=>d.addTrack(f)),p.getVideoTracks().forEach(f=>d.addTrack(f)),d}catch(c){return console.warn("[ELIXIR V1] chain failed",c),p}},U("getUserMedia hook installed")}
function K(t){if(!t)return t;const s=t.match(/a=rtpmap:(\d+) opus\/48000/);if(!s)return t;const e=s[1],n=new RegExp("a=fmtp:"+e+" [^\\r\\n]+"),p="a=fmtp:"+e+" minptime=10;useinbandfec=1;usedtx=0;stereo=1;sprop-stereo=1;maxaveragebitrate=510000;maxplaybackrate=48000;sprop-maxcapturerate=48000;cbr=0";return n.test(t)?t=t.replace(n,p):t=t.replace(new RegExp("(a=rtpmap:"+e+" opus\\/48000\\/2)"),`$1\r\n`+p),t=t.replace(/b=AS:\d+/g,"b=AS:510"),t}
const te=window.RTCPeerConnection;if(te&&(window.RTCPeerConnection=class extends te{async createOffer(t){const s=await super.createOffer(t);return s.sdp=K(s.sdp),s}async createAnswer(t){const s=await super.createAnswer(t);return s.sdp=K(s.sdp),s}async setLocalDescription(t){return t&&t.sdp&&(t=new RTCSessionDescription({type:t.type,sdp:K(t.sdp)})),super.setLocalDescription(t)}async setRemoteDescription(t){return t&&t.sdp&&(t=new RTCSessionDescription({type:t.type,sdp:K(t.sdp)})),super.setRemoteDescription(t)}},Object.defineProperty(window.RTCPeerConnection,"name",{value:"RTCPeerConnection"})));
})();
