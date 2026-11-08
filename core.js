(()=>{if(window.__elixirV1)return;window.__elixirV1=!0;const U=(...t)=>console.log("[ELIXIR V1]",...t);U("injector loaded, waiting for mic requests...");const h={preamp:1,opus:1.2,bitrate:510,exciter:0,stereo:!1,wider:!1,haas:!1},oe=`
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
                const input = inputs[0];
                const output = outputs[0];
                if (!input || !input.length || !input[0].length) return true;

                const channelCount = input.length;
                const frameLength = input[0].length;

                for (let i = 0; i < frameLength; i++) {
                    const gain = params.gain.length > 1 ? params.gain[i] : params.gain[0];
                    const rage = params.rage.length > 1 ? params.rage[i] : params.rage[0];
                    const distort = params.distort.length > 1 ? params.distort[i] : params.distort[0];
                    const bitrate = params.bitrate.length > 1 ? params.bitrate[i] : params.bitrate[0];
                    const gate = params.gate.length > 1 ? params.gate[i] : params.gate[0];
                    const mute = params.mute.length > 1 ? params.mute[i] : params.mute[0];
                    const reverb = params.reverb.length > 1 ? params.reverb[i] : params.reverb[0];

                    const effectiveRage = Math.log2(rage + 1) * 2.5;
                    const boost = gain * (1 + effectiveRage);
                    const step = 1 / (bitrate / 20);
                    const gateThreshold = gate * 0.0015;
                    const gateKnee = gateThreshold * 10;

                    for (let ch = 0; ch < channelCount; ch++) {
                        let s = input[ch][i];
                        if (mute > 0.5) { output[ch][i] = 0; continue; }

                        const dcR = 0.9975;
                        const prevX = this._dcX[ch];
                        this._dcX[ch] = s;
                        s = s - prevX + dcR * this._dcY[ch];
                        this._dcY[ch] = s;

                        const absSample = Math.abs(s);
                        if (absSample < gateThreshold) {
                            s = 0;
                        } else if (absSample < gateKnee) {
                            s *= (absSample - gateThreshold) / (gateKnee - gateThreshold);
                        }

                        const hpAlpha = 0.62;
                        const hp = hpAlpha * (this._hpOut[ch] + s - this._hpPrev[ch]);
                        this._hpPrev[ch] = s;
                        this._hpOut[ch] = hp;
                        s = s + hp * 0.28;

                        if (bitrate < 2500) {
                            s = Math.round(s / step) * step;
                        }

                        s *= boost;
                        s = this.softClip(s, 0.88);

                        if (rage > 0) {
                            const stage2gain = 1.0 + Math.log2(rage + 1) * 0.6;
                            s *= stage2gain;
                            s = this.softClip(s, 0.86);
                        }

                        s *= 1.25;
                        s = this.softClip(s, 0.90);

                        if (distort > 0) {
                            const drive = 1 + distort * 0.1;
                            const shaped = Math.tanh(s * drive);
                            const mix = Math.min(distort / 120, 0.9);
                            const absS = Math.abs(s);
                            s = s * (1 - mix) + shaped * (absS > 0.01 ? absS : 0.01) * mix;
                            s = this.softClip(s, 0.92);
                        }

                        if (reverb > 0.5) {
                            const wet = reverb / 100;
                            const feedback = 0.6 + wet * 0.32;
                            const damping = 0.3 + wet * 0.3;
                            const apCoeff = 0.6;

                            const preBuf = this._preDelay[ch];
                            const preI = this._preIdx[ch];
                            const preOut = preBuf[preI];
                            preBuf[preI] = s;
                            this._preIdx[ch] = (preI + 1) % this._preDelayLen;

                            let diff = preOut;
                            for (let ap = 0; ap < 2; ap++) {
                                const ab = this._apBufs[ch][ap];
                                const ai = this._apIdx[ch][ap];
                                const v = ab[ai];
                                ab[ai] = diff + apCoeff * v;
                                diff = v - apCoeff * diff;
                                this._apIdx[ch][ap] = (ai + 1) % this._apLens[ap];
                            }

                            const tmp = this._rvbTmp;
                            let lineSum = 0;
                            for (let t = 0; t < 8; t++) {
                                const buf = this._rvbBufs[ch][t];
                                const idx = this._rvbIdx[ch][t];
                                const d = buf[idx];
                                this._rvbLPState[ch][t] += damping * (d - this._rvbLPState[ch][t]);
                                tmp[t] = this._rvbLPState[ch][t];
                                lineSum += tmp[t];
                            }

                            const mixScale = lineSum * 0.25;
                            let reverbOut = 0;
                            for (let t = 0; t < 8; t++) {
                                const mixed = tmp[t] - mixScale;
                                const buf = this._rvbBufs[ch][t];
                                const idx = this._rvbIdx[ch][t];
                                buf[idx] = diff * 0.354 + mixed * feedback;
                                this._rvbIdx[ch][t] = (idx + 1) % buf.length;
                                reverbOut += tmp[t];
                            }
                            reverbOut *= 0.125;

                            const dryGain = Math.sqrt(1.0 - wet);
                            const wetGain = Math.sqrt(wet);
                            s = s * dryGain + reverbOut * wetGain;
                            s = this.softClip(s, 0.93);
                        }

                        if (s > 0.999) s = 0.999;
                        else if (s < -0.999) s = -0.999;

                        output[ch][i] = s;
                    }
                }
                return true;
            }
        }
        registerProcessor('revolutionary-processor', RevolutionaryProcessor);
    `,le=`
    class SmoothVoiceDSP extends AudioWorkletProcessor{
      constructor(){
        super();
        this.p={opus:1.2,pre:-175,exc:0,repeater:false,repMix:35,repTime:420,repCount:12,blackHole:false,bhMix:32,bhDecay:14,bhDepth:78,width:100,pan:0,auto:false,speed:.25,depth:100,reverbPower:0,aggressiveGain:0,rageGain:0,inputGain:0,outputBoost:0,inputBoost:0,outputGain:0,clearGain:0,smoothGain:0,voiceBoost:0,voiceClarity:0,loudness:0,distortion:0,bitrate:384};
        this.phase=0;
        this.env=0;
        this.speedInN=65536;
        this.speedInL=new Float32Array(this.speedInN);
        this.speedInR=new Float32Array(this.speedInN);
        this.speedWriteAbs=0;
        this.speedAnalysisAbs=0;
        this.speedPrimed=false;
        this.speedGrain=2048;
        this.speedHop=512;
        this.speedLatency=4096;
        this.speedOutN=32768;
        this.speedOutL=new Float32Array(this.speedOutN);
        this.speedOutR=new Float32Array(this.speedOutN);
        this.speedReadAbs=0;
        this.speedSynthAbs=4096;
        this.speedPrimedSpeed=1;
        this.rep=new Float32Array(576000);
        this.rp=0;
        this.dL=[new Float32Array(14903), new Float32Array(19799), new Float32Array(24107), new Float32Array(29303)];
        this.dR=[new Float32Array(16127), new Float32Array(21191), new Float32Array(25799), new Float32Array(30727)];
        this.dp=[0,0,0,0];
        this.lpL=[0,0,0,0];
        this.lpR=[0,0,0,0];
        this.preL=new Float32Array(4800);
        this.preR=new Float32Array(4800);
        this.pp=0;
        this.port.onmessage=e=>this.p={...this.p,...e.data};
      }

      process(inputs,outputs){
        const i=inputs[0],o=outputs[0];
        if(!i||!i[0])return true;
        const L=i[0],R=i[1]||i[0];
        const OL=o[0],OR=o[1]||o[0];
        const p=this.p,sr=sampleRate;
        const voiceSpeed=1;
        const bitrateKbps=Math.max(32,Math.min(384,Number(p.bitrate)||384));
        const bitrateHeadroom=1;
        const opus=Math.max(1,Math.min(10000,+p.opus||1));
        const preDb=Math.max(-320,Math.min(320,+p.pre||0));
        const opusDb=opus<=1 ? 0 : Math.min(250,165*Math.log10(opus));
        const preDriveDb=preDb<0 ? Math.max(-320,preDb) : Math.min(320,preDb*1.20);
        const gain=Math.pow(10,(opusDb+preDriveDb)/20);
        const exc=Math.max(0,Math.min(1,(+p.exc||0)/500));
        const width=Math.max(0,Math.min(2.0,Math.pow(Math.max(0,Math.min(200,(+p.width||100)))/100,0.62)));
        const xdb=v=>Math.min(150,180*Math.log10(1+Math.max(0,+v||0))/Math.log10(50001));
        const inDb=Math.min(210,(xdb(p.aggressiveGain)*1.70)+(xdb(p.rageGain)*1.70)+(xdb(p.inputGain)*1.55)+(xdb(p.inputBoost)*1.55));
        const outDb=Math.min(240,(xdb(p.outputBoost)*1.85)+(xdb(p.outputGain)*1.95)+(xdb(p.loudness)*1.80));
        const clarityDb=Math.min(120,(xdb(p.clearGain)*0.60)+(xdb(p.voiceBoost)*0.60)+(xdb(p.voiceClarity)*0.60));
        const smoothAmt=xdb(p.smoothGain);
        const distNorm=Math.min(1,Math.max(0,+p.distortion||0)/10000);
        const matrixIn=Math.pow(10,Math.min(180,inDb)/20);
        const clearMix=Math.min(1,clarityDb/16);
        const shapeDrive=1+distNorm*120;
        const attack=Math.exp(-1/(sr*.004));
        const release=Math.exp(-1/(sr*.12));

        if(!this.speedPrimed){
          this.speedRead=(this.speedWrite-this.speedLatency+this.speedN)%this.speedN;
          this.speedAnalysis=this.speedRead;
          this.speedPrimed=true;
        }

        const readSample=(buf,pos)=>{
          const base=Math.floor(pos);
          const i0=((base%this.speedN)+this.speedN)%this.speedN;
          const i1=(i0+1)%this.speedN;
          const f=pos-base;
          return buf[i0]+(buf[i1]-buf[i0])*f;
        };

        const speedIsUnity=Math.abs(voiceSpeed-1)<0.001;
        if(speedIsUnity){
          this.speedPrimed=false;
          this.speedPrimedSpeed=1;
          this.speedReadAbs=this.speedWriteAbs;
        }

        const inAt=(abs,buf)=>buf[((abs%this.speedInN)+this.speedInN)%this.speedInN];
        const scheduleGrain=()=>{
          const analysisHop=this.speedHop*voiceSpeed;
          const available=this.speedWriteAbs-this.speedAnalysisAbs;
          if(available < this.speedGrain+256) return false;
          if(this.speedSynthAbs-this.speedReadAbs > this.speedOutN-this.speedGrain-256) return false;
          const base=this.speedAnalysisAbs;
          for(let k=0;k<this.speedGrain;k++){
            const w=0.5-0.5*Math.cos(2*Math.PI*k/(this.speedGrain-1));
            const idx=(this.speedSynthAbs+k)%this.speedOutN;
            this.speedOutL[idx]+=inAt(base+k,this.speedInL)*w;
            this.speedOutR[idx]+=inAt(base+k,this.speedInR)*w;
          }
          this.speedAnalysisAbs+=Math.max(1,analysisHop);
          this.speedSynthAbs+=this.speedHop;
          return true;
        };

        if(!speedIsUnity && !this.speedPrimed){
          this.speedAnalysisAbs=Math.max(0,this.speedWriteAbs-this.speedLatency);
          this.speedReadAbs=this.speedWriteAbs-this.speedLatency;
          this.speedSynthAbs=this.speedReadAbs;
          this.speedPrimed=true;
          this.speedPrimedSpeed=voiceSpeed;
        }

        const repMix=Math.max(0,Math.min(1,(+p.repMix||0)/100));
        const repDelay=Math.max(120,Math.min(900,+p.repTime||420));
        const repCount=Math.max(2,Math.min(16,Math.round(+p.repCount||12)));
        const repN=Math.max(1,Math.min(this.rep.length-1,Math.round(sr*repDelay/1000)));
        const rp=Math.max(0,Math.min(1000,+p.reverbPower||0));
        const wet=Math.min(1,Math.pow(rp/1000,.62));
        const depth=Math.min(1,.32+.98*Math.pow(rp/1000,.62));
        const decay=5+85*Math.pow(rp/1000,.70);
        const fb=Math.min(.994,1-Math.exp(-3.2/decay));
        const damp=Math.max(.022,.09-.068*Math.pow(rp/1000,.65));

        for(let n=0;n<OL.length;n++){
          this.speedInL[this.speedWriteAbs%this.speedInN]=L[n];
          this.speedInR[this.speedWriteAbs%this.speedInN]=R[n];
          this.speedWriteAbs++;

          let sl=L[n], sr0=R[n];
          if(!speedIsUnity){
            while(scheduleGrain()){}
            const oi=this.speedReadAbs%this.speedOutN;
            sl=this.speedOutL[oi];
            sr0=this.speedOutR[oi];
            this.speedOutL[oi]=0;
            this.speedOutR[oi]=0;
            this.speedReadAbs++;
          }

          let l=sl*gain*matrixIn;
          let r=sr0*gain*matrixIn;
          const mid0=(l+r)*.5;
          const clarityCurve=Math.tanh(mid0*(1+clearMix*3.2));
          l=l*(1-clearMix*.16)+clarityCurve*(clearMix*.16);
          r=r*(1-clearMix*.16)+clarityCurve*(clearMix*.16);

          if(distNorm>0){
            const dryL=l,dryR=r;
            const wetL=Math.tanh(l*shapeDrive);
            const wetR=Math.tanh(r*shapeDrive);
            const mix=.14+.86*distNorm;
            l=dryL*(1-mix)+wetL*mix;
            r=dryR*(1-mix)+wetR*mix;
          }

          if(exc>0){
            const d=1+exc*30.0;
            const w=.12+exc*.88;
            l=l*(1-w)+Math.tanh(l*d)*w;
            r=r*(1-w)+Math.tanh(r*d)*w;
          }

          const mid=(l+r)*.5;
          const side=(l-r)*.5*width;
          l=mid+side;
          r=mid-side;

          let repeat=0;
          if(p.repeater&&repMix>0){
            const mix=Math.min(1,repMix*1.22);
            for(let tap=1;tap<=repCount;tap++){
              const idx=(this.rp-repN*tap+this.rep.length)%this.rep.length;
              repeat+=this.rep[idx]*Math.pow(.84,tap-1);
            }
            repeat*=mix/Math.max(1,Math.sqrt(repCount));
          }
          this.rep[this.rp]=(l+r)*.5;
          this.rp=(this.rp+1)%this.rep.length;
          if(p.repeater) {
            l+=repeat*.82;
            r+=repeat*.82;
          }

          let revL=0,revR=0;
          if(p.blackHole&&wet>0){
            const a=this.dL[0][this.dp[0]];
            const b=this.dL[1][this.dp[1]];
            const c=this.dL[2][this.dp[2]];
            const d=this.dL[3][this.dp[3]];
            const e=this.dR[0][this.dp[0]];
            const f=this.dR[1][this.dp[1]];
            const g=this.dR[2][this.dp[2]];
            const q=this.dR[3][this.dp[3]];

            this.lpL[0]+=damp*(a-this.lpL[0]);
            this.lpL[1]+=damp*(b-this.lpL[1]);
            this.lpL[2]+=damp*(c-this.lpL[2]);
            this.lpL[3]+=damp*(d-this.lpL[3]);
            this.lpR[0]+=damp*(e-this.lpR[0]);
            this.lpR[1]+=damp*(f-this.lpR[1]);
            this.lpR[2]+=damp*(g-this.lpR[2]);
            this.lpR[3]+=damp*(q-this.lpR[3]);

            const A=this.lpL[0],B=this.lpL[1],C=this.lpL[2],D=this.lpL[3];
            const E=this.lpR[0],F=this.lpR[1],G=this.lpR[2],Q=this.lpR[3];

            const m0=( A+B+C+D)*.5;
            const m1=( A-B+C-D)*.5;
            const m2=( A+B-C-D)*.5;
            const m3=( A-B-C+D)*.5;

            const n0=( E+F+G+Q)*.5;
            const n1=( E-F+G-Q)*.5;
            const n2=( E+F-G-Q)*.5;
            const n3=( E-F-G+Q)*.5;

            revL=(m0+n1+m2-n3)*.25;
            revR=(n0+m1+n2-m3)*.25;

            const pdL=this.preL[this.pp];
            const pdR=this.preR[this.pp];
            this.preL[this.pp]=l;
            this.preR[this.pp]=r;

            const inL=pdL*.42;
            const inR=pdR*.42;

            this.dL[0][this.dp[0]]=inL+fb*( m0+n1 )*.50;
            this.dL[1][this.dp[1]]=inL+fb*( m1-n2 )*.50;
            this.dL[2][this.dp[2]]=inL+fb*( m2+n3 )*.50;
            this.dL[3][this.dp[3]]=inL+fb*( m3-n0 )*.50;

            this.dR[0][this.dp[0]]=inR+fb*( n0+m1 )*.50;
            this.dR[1][this.dp[1]]=inR+fb*( n1-m2 )*.50;
            this.dR[2][this.dp[2]]=inR+fb*( n2+m3 )*.50;
            this.dR[3][this.dp[3]]=inR+fb*( n3-m0 )*.50;

            for(let k=0;k<4;k++){
              this.dp[k]=(this.dp[k]+1)%this.dL[k].length;
            }
            this.pp=(this.pp+1)%this.preL.length;

            const depthGain=.38+1.05*depth;
            l+=revL*Math.min(1,wet*1.28)*depthGain;
            r+=revR*Math.min(1,wet*1.28)*depthGain;
          }

          const lev=Math.max(Math.abs(l),Math.abs(r));
          if(lev>this.env)this.env=lev+(this.env-lev)*attack;
          else this.env=lev+(this.env-lev)*release;

          const th=.16;
          if(this.env>th){
            const over=this.env/th;
            const comp=th*Math.pow(over,.12);
            const scale=(comp/this.env)*4.15;
            l*=scale*4.20;r*=scale*4.20;
          }else{
            l*=12.50;r*=12.50;
          }

          const makeupDb=120 + Math.min(260, outDb*2.05);
          const brNorm=Math.max(0,Math.min(1,(bitrateKbps-32)/(384-32)));
          const bitrateLevelDb=-8 + 8*Math.pow(brNorm,0.72);
          const outputScale=Math.pow(10,(makeupDb+bitrateLevelDb)/20)*bitrateHeadroom;
          l*=outputScale;
          r*=outputScale;

          let pan=+p.pan||0;
          if(p.auto){
            this.phase+=2*Math.PI*Math.min(12,Math.max(.05,(+p.speed||.25)*1.15))/sr;
            if(this.phase>Math.PI*2)this.phase-=Math.PI*2;
            pan=Math.sin(this.phase)*Math.min(1,Math.pow(Math.max(0,Math.min(100,+p.depth||0))/100,0.72));
          }
          const ang=(pan+1)*Math.PI/4;
          l*=Math.cos(ang)*1.4142;
          r*=Math.sin(ang)*1.4142;

          const finalDrive=24.00;
          l=Math.tanh(l*finalDrive);
          r=Math.tanh(r*finalDrive);

          OL[n]=l;
          OR[n]=r;
        }
        return true;
      }
    }
    registerProcessor("smooth-voice-dsp",SmoothVoiceDSP);
  `,ce=`
        class GodTierProcessor extends AudioWorkletProcessor {
            constructor() {
                super();
                this._dcX = new Float32Array(8);
                this._dcY = new Float32Array(8);
                this._hpPrev = new Float32Array(8);
                this._hpOut = new Float32Array(8);
                this._wideDelay = new Float32Array(128);
                this._wideIndex = 0;
                this._behindDelay = new Float32Array(64);
                this._behindIndex = 0;
                this._spatialDelayL = new Float32Array(256);
                this._spatialDelayR = new Float32Array(256);
                this._spatialIndex = 0;
                this._spatialLP = 0;
                this._spatialPrev = 0;
                this._spatialHP = 0;
                this._spatialFarLP = 0;
                this._spatialSmoothAngle = 0;
                this._spatialSmoothDistance = 0.25;
                this._wideSideLP = 0;
                this._wideAP_L = 0;
                this._wideAP_R = 0;
                this._widePrevIn = 0;
                this._widePrevL = 0;
                this._widePrevR = 0;
                this._haasBuf = new Float32Array(2881);
                this._haasIndex = 0;
                const cDelays = [1913, 2087, 2281, 2477, 2713, 2953, 3191, 3457];
                this._combBufs = cDelays.map(len => new Float32Array(len));
                this._combIndices = new Int32Array(cDelays.length);
                this._combFilters = new Float32Array(cDelays.length);
                this._combLengths = cDelays;
                const apDelays = [787, 531, 829, 563];
                this._apBufs = apDelays.map(len => new Float32Array(len));
                this._apIndices = new Int32Array(apDelays.length);
                this._apLengths = apDelays;
                this._eqG = [0, 0, 0, 0, 0, 0, 0];
                this._eqSL = Array.from({ length: 7 }, () => [0, 0, 0, 0]);
                this._eqSR = Array.from({ length: 7 }, () => [0, 0, 0, 0]);
                this.port.onmessage = (e) => {
                    if (e.data && e.data.type === 'SET_EQ7' && Array.isArray(e.data.eq7) && e.data.eq7.length === 7) {
                        this._eqG = e.data.eq7.map(v => Math.max(-12, Math.min(12, Number(v) || 0)));
                    }
                };
            }

            bq(x, s, c) {
                const y = c[0]*x + c[1]*s[0] + c[2]*s[1] - c[3]*s[2] - c[4]*s[3];
                s[1]=s[0]; s[0]=x; s[3]=s[2]; s[2]=y;
                return y;
            }

            peakEQ(f, g, Q, sr) {
                const A=Math.pow(10,g/40), w=2*Math.PI*f/sr, cos=Math.cos(w), sin=Math.sin(w), a=sin/(2*Q);
                const b0=1+a*A, b1=-2*cos, b2=1-a*A, a0=1+a/A, a1=-2*cos, a2=1-a/A;
                return [b0/a0,b1/a0,b2/a0,a1/a0,a2/a0];
            }

            static get parameterDescriptors() {
                return [
                    { name: 'talkSet', defaultValue: 1.0, minValue: 1.0, maxValue: 127.0 },
                    { name: 'preAmp', defaultValue: 1.0, minValue: 1.0, maxValue: 5000.0 },
                    { name: 'inputDrive', defaultValue: 0.0, minValue: 0.0, maxValue: 10000.0 },
                    { name: 'distortion', defaultValue: 0.0, minValue: 0.0, maxValue: 5000.0 },
                    { name: 'monoPan', defaultValue: 0.0, minValue: -100.0, maxValue: 100.0 },
                    { name: 'wider', defaultValue: 0.0, minValue: 0.0, maxValue: 460.0 },
                    { name: 'quickHaas', defaultValue: 0.0, minValue: 0.0, maxValue: 30.0 },
                    { name: 'deepExciter', defaultValue: 0.0, minValue: 0.0, maxValue: 200.0 },
                    { name: 'deepPresence', defaultValue: 0.0, minValue: 0.0, maxValue: 5000.0 },
                    { name: 'reverb', defaultValue: 0.0, minValue: 0.0, maxValue: 100.0 },
                    { name: 'bitrate', defaultValue: 384.0, minValue: 1.0, maxValue: 384.0 },
                    { name: 'inHead', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0 },
                    { name: 'behind', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0 },
                    { name: 'spatialMode', defaultValue: 0.0, minValue: 0.0, maxValue: 7.0 },
                    { name: 'spatialAngle', defaultValue: 0.0, minValue: -180.0, maxValue: 180.0 },
                    { name: 'spatialDistance', defaultValue: 0.25, minValue: 0.0, maxValue: 1.0 },
                ];
            }

            extremeSoftClip(x, knee) {
                const abs = Math.abs(x);
                if (abs <= knee) return x;
                const sign = x > 0 ? 1 : -1;
                const excess = abs - knee;
                const headroom = 1.0 - knee;
                const compressed = headroom * (excess / (excess + headroom * 0.15));
                return sign * (knee + compressed);
            }

            process(inputs, outputs, params) {
                const input = inputs[0];
                const output = outputs[0];
                if (!input || !input.length || !input[0].length) return true;

                const channelCount = input.length;
                const frameLength = input[0].length;
                const eqFreqs = [65, 150, 400, 1000, 2500, 6500, 15000];
                const eqCoeffs = this._eqG.map((g, b) => this.peakEQ(eqFreqs[b], g, 1.4, sampleRate || 48000));

                for (let i = 0; i < frameLength; i++) {
                    const talkSetVal = params.talkSet.length > 1 ? params.talkSet[i] : params.talkSet[0];
                    const preAmpVal = params.preAmp.length > 1 ? params.preAmp[i] : params.preAmp[0];
                    const inputDriveVal = params.inputDrive.length > 1 ? params.inputDrive[i] : params.inputDrive[0];
                    const distortionVal = params.distortion.length > 1 ? params.distortion[i] : params.distortion[0];
                    const monoPanVal = params.monoPan.length > 1 ? params.monoPan[i] : params.monoPan[0];
                    const widerVal = params.wider.length > 1 ? params.wider[i] : params.wider[0];
                    const quickHaasVal = params.quickHaas.length > 1 ? params.quickHaas[i] : params.quickHaas[0];
                    const deepExciterVal = params.deepExciter.length > 1 ? params.deepExciter[i] : params.deepExciter[0];
                    const deepPresenceVal = params.deepPresence.length > 1 ? params.deepPresence[i] : params.deepPresence[0];
                    const reverbVal = params.reverb.length > 1 ? params.reverb[i] : params.reverb[0];
                    const bitrateVal = params.bitrate.length > 1 ? params.bitrate[i] : params.bitrate[0];
                    const inHeadVal = params.inHead.length > 1 ? params.inHead[i] : params.inHead[0];
                    const behindVal = params.behind.length > 1 ? params.behind[i] : params.behind[0];
                    const spatialModeVal = params.spatialMode.length > 1 ? params.spatialMode[i] : params.spatialMode[0];
                    const spatialAngleVal = params.spatialAngle.length > 1 ? params.spatialAngle[i] : params.spatialAngle[0];
                    const spatialDistanceVal = params.spatialDistance.length > 1 ? params.spatialDistance[i] : params.spatialDistance[0];

                    const bitrateNorm = Math.min(1.0, Math.max(0.0, bitrateVal / 384.0));
                    let leftIn = input[0][i];
                    let rightIn = channelCount > 1 ? input[1][i] : leftIn;

                    for (let b = 0; b < 7; b++) {
                        if (this._eqG[b] === 0) continue;
                        leftIn = this.bq(leftIn, this._eqSL[b], eqCoeffs[b]);
                        rightIn = this.bq(rightIn, this._eqSR[b], eqCoeffs[b]);
                    }

                    let s = (leftIn + rightIn) * 0.5;
                    const dcR = 0.9985;
                    const prevX = this._dcX[0];
                    this._dcX[0] = s;
                    s = s - prevX + dcR * this._dcY[0];
                    this._dcY[0] = s;

                    const hpAlpha = 0.55;
                    const hp = hpAlpha * (this._hpOut[0] + s - this._hpPrev[0]);
                    this._hpPrev[0] = s;
                    this._hpOut[0] = hp;
                    s = s + hp * 0.3;

                    const preNorm = Math.max(0, preAmpVal - 1.0);
                    s *= 1.0 + Math.log1p(preNorm) * 2.2;

                    if (deepPresenceVal > 0) {
                        const prsFactor = (deepPresenceVal / 100.0) * 24.0;
                        const presenceBand = s - this._hpOut[0];
                        s += presenceBand * prsFactor;
                    }

                    if (deepExciterVal > 0) {
                        const excFactor = (deepExciterVal / 100.0) * 40.0;
                        const safeS = Math.max(-2.5, Math.min(2.5, s));
                        const harmonic = (Math.sin(safeS * Math.PI) * 2.4) + (safeS * safeS * Math.sign(safeS) * 3.8);
                        s += harmonic * excFactor;
                    }

                    if (inputDriveVal > 0) {
                        const driveFactor = inputDriveVal / 100.0;
                        const driveGain = 1.0 + driveFactor * 45.0;
                        s = Math.tanh(s * driveGain * 0.72) * 1.55;
                    }

                    if (distortionVal > 0) {
                        const distFactor = distortionVal / 100.0;
                        const driveDist = s * (1.0 + distFactor * 80.0);
                        const softDist = this.extremeSoftClip(driveDist, 0.58);
                        const folded = Math.sin(softDist * (Math.PI * 0.5));
                        const blend = Math.min(0.78, distFactor * 0.16);
                        s = softDist * (1.0 - blend) + folded * blend;
                        s *= 1.0 + Math.min(24.0, distFactor * 3.0);
                    }

                    let revL = 0;
                    let revR = 0;
                    if (reverbVal > 0.01) {
                        const rNorm = reverbVal / 100.0;
                        const wet = rNorm * 5.2;
                        const feedback = 0.88 + rNorm * 0.116;
                        const damp = 0.05;
                        const revIn = s;

                        for (let c = 0; c < 8; c++) {
                            const buf = this._combBufs[c];
                            const idx = this._combIndices[c];
                            const delayed = buf[idx];
                            this._combFilters[c] = delayed * (1.0 - damp) + this._combFilters[c] * damp;
                            buf[idx] = revIn + this._combFilters[c] * feedback;
                            this._combIndices[c] = (idx + 1) % this._combLengths[c];
                            if (c % 2 === 0) revL += delayed;
                            else revR += delayed;
                        }

                        revL *= 0.28;
                        revR *= 0.28;

                        for (let a = 0; a < 2; a++) {
                            const buf = this._apBufs[a];
                            const idx = this._apIndices[a];
                            const delayed = buf[idx];
                            const apOut = -revL + delayed;
                            buf[idx] = revL + delayed * 0.62;
                            this._apIndices[a] = (idx + 1) % this._apLengths[a];
                            revL = apOut;
                        }

                        for (let a = 2; a < 4; a++) {
                            const buf = this._apBufs[a];
                            const idx = this._apIndices[a];
                            const delayed = buf[idx];
                            const apOut = -revR + delayed;
                            buf[idx] = revR + delayed * 0.62;
                            this._apIndices[a] = (idx + 1) % this._apLengths[a];
                            revR = apOut;
                        }

                        revL *= wet * 1.45;
                        revR *= wet * 1.45;
                    }

                    let outSampleL = s + revL;
                    let outSampleR = s + revR;

                    if (quickHaasVal > 0.01) {
                        const delaySamples = Math.max(1, Math.min(1440, Math.round((quickHaasVal / 1000.0) * 48000)));
                        const writeIndex = this._haasIndex;
                        const readIndex = (writeIndex - delaySamples + 2881) % 2881;
                        const delayed = this._haasBuf[readIndex];
                        this._haasBuf[writeIndex] = s;
                        this._haasIndex = (writeIndex + 1) % 2881;

                        const h = Math.min(1.0, quickHaasVal / 30.0);
                        const haasMix = 0.78 * h;
                        outSampleL = s;
                        outSampleR = (s * (1.0 - haasMix)) + (delayed * haasMix);
                    } else {
                        this._haasBuf[this._haasIndex] = s;
                        this._haasIndex = (this._haasIndex + 1) % 2881;
                    }

                    if (widerVal > 0.01) {
                        const wideNorm = Math.min(1.0, Math.max(0.0, widerVal / 460.0));
                        const idx = this._wideIndex;
                        const len = this._wideDelay.length;
                        const d1 = this._wideDelay[(idx + len - 72) % len];
                        const d2 = this._wideDelay[(idx + len - 113) % len];
                        const stereoMid = (outSampleL + outSampleR) * 0.5;
                        const stereoSideL = outSampleL - stereoMid;
                        const stereoSideR = outSampleR - stereoMid;
                        this._wideDelay[idx] = stereoMid;
                        this._wideIndex = (idx + 1) % len;

                        const decorL = d1 - stereoMid * 0.18;
                        const decorR = d2 - stereoMid * 0.18;
                        const amount = Math.pow(wideNorm, 0.72) * 1.35;
                        const addedSideL = Math.tanh(decorL * amount);
                        const addedSideR = Math.tanh(decorR * amount);
                        const sideAmount = 0.95 * wideNorm;

                        outSampleL = stereoMid + stereoSideL + addedSideL * sideAmount;
                        outSampleR = stereoMid + stereoSideR - addedSideR * sideAmount;
                    } else {
                        this._wideDelay[this._wideIndex] = (outSampleL + outSampleR) * 0.5;
                        this._wideIndex = (this._wideIndex + 1) % this._wideDelay.length;
                    }

                    if (inHeadVal > 0.5) {
                        const BOOST_MULTIPLIER = 3.8;
                        outSampleL *= BOOST_MULTIPLIER;
                        outSampleR *= -BOOST_MULTIPLIER;
                    } else if (behindVal > 0.5) {
                        const idx = this._behindIndex;
                        const len = this._behindDelay.length;
                        const delayedL = this._behindDelay[(idx + len - 17) % len];
                        const delayedR = this._behindDelay[(idx + len - 29) % len];
                        this._behindDelay[idx] = (outSampleL + outSampleR) * 0.5;
                        this._behindIndex = (idx + 1) % len;

                        const mid = (outSampleL + outSampleR) * 0.5;
                        const side = (outSampleL - outSampleR) * 0.5;
                        const rearMix = 0.78;
                        const cross = 0.92;
                        outSampleL = (mid * (1.0 - rearMix) - side * rearMix) + delayedR * cross;
                        outSampleR = (mid * (1.0 - rearMix) + side * rearMix) + delayedL * cross;
                        outSampleL *= 1.18;
                        outSampleR *= 1.18;
                    }

                    if (spatialModeVal > 0.5 && !inHeadVal && !behindVal) {
                        const mode = Math.round(spatialModeVal);
                        const targetAngle = Math.max(-180, Math.min(180, spatialAngleVal));
                        const targetDist = Math.max(0, Math.min(1, spatialDistanceVal));

                        const angleDelta = Math.max(-3.5, Math.min(3.5, targetAngle - this._spatialSmoothAngle));
                        this._spatialSmoothAngle += angleDelta * 0.18;
                        this._spatialSmoothDistance += (targetDist - this._spatialSmoothDistance) * 0.035;

                        const angle = this._spatialSmoothAngle;
                        const dist = this._spatialSmoothDistance;
                        const rad = angle * Math.PI / 180.0;
                        const az = Math.sin(rad);
                        const rear = 0.5 * (1.0 - Math.cos(rad));

                        const mid = (outSampleL + outSampleR) * 0.5;
                        const side = (outSampleL - outSampleR) * 0.5;

                        const lpAlpha = 0.045 + (0.035 * (1.0 - rear)) + (0.025 * (1.0 - dist));
                        this._spatialLP += (mid - this._spatialLP) * lpAlpha;
                        const hf = mid - this._spatialLP;
                        this._spatialHP += (hf - this._spatialHP) * 0.12;

                        const pan = Math.max(-1, Math.min(1, az));
                        const panPos = (pan + 1.0) * 0.25 * Math.PI;
                        const panL = Math.cos(panPos);
                        const panR = Math.sin(panPos);

                        const maxITD = 32;
                        const itd = Math.round(Math.abs(pan) * maxITD);
                        const w = this._spatialIndex;
                        const dl = this._spatialDelayL[(w + 256 - (pan > 0 ? itd : 0)) & 255];
                        const dr = this._spatialDelayR[(w + 256 - (pan < 0 ? itd : 0)) & 255];
                        this._spatialDelayL[w] = mid;
                        this._spatialDelayR[w] = mid;
                        this._spatialIndex = (w + 1) & 255;

                        let baseL = dl * panL;
                        let baseR = dr * panR;
                        const center = mid * 0.18;
                        baseL += center;
                        baseR += center;

                        const rearSignal = this._spatialLP * (0.72 - dist * 0.12) + this._spatialHP * 0.12;
                        const rearAmount = rear * 0.62;
                        const rearL = rearSignal * panL + rearSignal * 0.06;
                        const rearR = rearSignal * panR + rearSignal * 0.06;

                        outSampleL = baseL * (1.0 - rearAmount) + rearL * rearAmount;
                        outSampleR = baseR * (1.0 - rearAmount) + rearR * rearAmount;

                        if (mode === 1) {
                            outSampleL += hf * 0.055;
                            outSampleR += hf * 0.055;
                        } else if (mode === 2) {
                            outSampleL += hf * 0.20;
                            outSampleR += hf * 0.20;
                            outSampleL *= 1.015;
                            outSampleR *= 1.015;
                        } else if (mode === 3) {
                            outSampleL -= hf * 0.22;
                            outSampleR -= hf * 0.22;
                            outSampleL *= 0.985;
                            outSampleR *= 0.985;
                        } else if (mode === 4) {
                            const far = dist;
                            const attenuation = 1.0 - far * 0.58;
                            const direct = 1.0 - far * 0.30;
                            this._spatialFarLP += (mid - this._spatialFarLP) * (0.018 + (1.0 - far) * 0.025);
                            const farBody = this._spatialFarLP * (0.20 + far * 0.35);
                            outSampleL = (outSampleL * direct + farBody) * attenuation;
                            outSampleR = (outSampleR * direct + farBody) * attenuation;
                        } else if (mode === 5) {
                            const level = 1.0 - dist * 0.20;
                            outSampleL *= level;
                            outSampleR *= level;
                        }

                        outSampleL = outSampleL * 0.995 + mid * 0.005;
                        outSampleR = outSampleR * 0.995 + mid * 0.005;
                    } else {
                        const targetAngle = Math.max(-180, Math.min(180, spatialAngleVal));
                        const targetDist = Math.max(0, Math.min(1, spatialDistanceVal));
                        this._spatialSmoothAngle += (targetAngle - this._spatialSmoothAngle) * 0.025;
                        this._spatialSmoothDistance += (targetDist - this._spatialSmoothDistance) * 0.025;
                    }

                    const talkNorm = Math.max(0.0, Math.min(1.0, (talkSetVal - 1.0) / 126.0));
                    const rawTalk = 1.0 + Math.pow(talkNorm, 1.4) * 10.0;
                    const talkGain = Math.min(20.0, Math.max(1.0, isFinite(rawTalk) ? rawTalk : 1.0));
                    outSampleL *= talkGain;
                    outSampleR *= talkGain;

                    const bitrateGain = 0.18 + 0.82 * Math.pow(bitrateNorm, 0.78);
                    outSampleL *= bitrateGain;
                    outSampleR *= bitrateGain;

                    outSampleL = this.extremeSoftClip(outSampleL, 0.75);
                    outSampleL = Math.tanh(outSampleL * 1.8);

                    outSampleR = this.extremeSoftClip(outSampleR, 0.75);
                    outSampleR = Math.tanh(outSampleR * 1.8);

                    if (isNaN(outSampleL) || !isFinite(outSampleL)) outSampleL = 0;
                    if (outSampleL > 0.998) outSampleL = 0.998;
                    else if (outSampleL < -0.998) outSampleL = -0.998;

                    if (isNaN(outSampleR) || !isFinite(outSampleR)) outSampleR = 0;
                    if (outSampleR > 0.998) outSampleR = 0.998;
                    else if (outSampleR < -0.998) outSampleR = -0.998;

                    const panNorm = monoPanVal / 100.0;
                    const panL = panNorm <= 0 ? 1.0 : (1.0 - panNorm);
                    const panR = panNorm >= 0 ? 1.0 : (1.0 + panNorm);

                    output[0][i] = outSampleL * panL;
                    if (output.length > 1) {
                        output[1][i] = outSampleR * panR;
                    }
                }
                return true;
            }
        }
        registerProcessor('godtier-processor', GodTierProcessor);
    `,Z={},j=(t,s)=>Z[t]||(Z[t]=URL.createObjectURL(new Blob([s],{type:"application/javascript"}))),pe={preamp:1,opus:1.2,bitrate:510,exciter:0,stereo:!1,wider:!1,haas:!1};let C=null,z=null,P=null,ee=null;function de(){if(!P||P.state==="closed"){const t=window.AudioContext||window.webkitAudioContext;try{P=new t({latencyHint:"interactive",sampleRate:48e3})}catch{P=new t}ee=Promise.all([P.audioWorklet.addModule(j("sky",oe)),P.audioWorklet.addModule(j("fvck",le)),P.audioWorklet.addModule(j("p4ck",ce))])}return P}const he=()=>{P&&P.state==="suspended"&&P.resume().catch(()=>{})};["click","touchstart","touchend","pointerdown","keydown","visibilitychange","focus"].forEach(t=>window.addEventListener(t,he,{passive:!0}));function me(){if(C){try{C.source.disconnect()}catch{}["sky","fvck","p4ck"].forEach(t=>{try{C[t].disconnect()}catch{}}),C=null}}async function ue(t){const s=de();s.state==="suspended"&&await s.resume().catch(()=>{}),await ee,me();const e=s.createMediaStreamSource(t),n=new AudioWorkletNode(s,"revolutionary-processor",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:"explicit",parameterData:{gain:h.preamp,rage:0,distort:0,bitrate:2500,gate:0,mute:0,reverb:0}}),p=new AudioWorkletNode(s,"smooth-voice-dsp",{outputChannelCount:[2]});p.port.postMessage({opus:h.opus,exc:h.exciter});const c=new AudioWorkletNode(s,"godtier-processor",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});c.channelCount=2,c.channelCountMode="explicit",c.channelInterpretation="discrete";const d=s.createMediaStreamDestination();d.channelCount=2;const f=s.createChannelSplitter(2),F=s.createAnalyser();F.fftSize=512;const M=s.createAnalyser();M.fftSize=512,e.connect(n),n.connect(p),p.connect(c),c.connect(d),c.connect(f),f.connect(F,0),f.connect(M,1);const v=d.stream.getAudioTracks()[0],_=t.getAudioTracks()[0];if(v&&_){v.enabled=!0;const i=v.stop.bind(v);v.stop=function(){try{_.stop()}catch{}i()},_.addEventListener("ended",()=>{try{v.stop()}catch{}J()})}return C={ctx:s,out:d,source:e,sky:n,fvck:p,p4ck:c,anL:F,anR:M,track:v},z=C,X(),U("mic captured, chain attached. sampleRate =",s.sampleRate),d.stream}function X(){const t=C;if(t&&t.track&&t.track.readyState!=="ended"){const s=t.ctx.currentTime,e=.014;try{t.sky.parameters.get("gain").setTargetAtTime(h.preamp,s,e),t.fvck.port.postMessage({opus:h.opus,exc:h.exciter});const n=t.p4ck.parameters;n.get("wider").setTargetAtTime(h.wider?460:0,s,e),n.get("quickHaas").setTargetAtTime(h.haas?30:0,s,e),n.get("inHead").setTargetAtTime(h.stereo?1:0,s,e)}catch{}}J()}if(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){const t=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async s=>{if(!s||!s.audio)return t(s);const e=s.audio,n={echoCancellation:!1,noiseSuppression:!1,autoGainControl:!1,channelCount:{ideal:2,min:1},googEchoCancellation:!1,googAutoGainControl:!1,googNoiseSuppression:!1,googHighpassFilter:!1};e&&typeof e=="object"&&e.deviceId&&(n.deviceId=e.deviceId);const p=await t({...s,audio:n});if(p.getAudioTracks().length===0)return p;try{const c=await ue(p),d=new MediaStream;return c.getAudioTracks().forEach(f=>d.addTrack(f)),p.getVideoTracks().forEach(f=>d.addTrack(f)),d}catch(c){return console.warn("[ELIXIR V1] chain failed, using raw mic",c),p}},U("getUserMedia hook installed")}else U("navigator.mediaDevices unavailable - cannot hook");function K(t){if(!t)return t;const s=t.match(/a=rtpmap:(\d+) opus\/48000/);if(!s)return t;const e=s[1],n=new RegExp("a=fmtp:"+e+" [^\\r\\n]+"),p="a=fmtp:"+e+" minptime=10;useinbandfec=1;usedtx=0;stereo=1;sprop-stereo=1;maxaveragebitrate=510000;maxplaybackrate=48000;sprop-maxcapturerate=48000;cbr=0";return n.test(t)?t=t.replace(n,p):t=t.replace(new RegExp("(a=rtpmap:"+e+" opus\\/48000\\/2)"),`$1\r
`+p),t=t.replace(/b=AS:\d+/g,"b=AS:510"),t}const te=window.RTCPeerConnection;if(te&&(window.RTCPeerConnection=class extends te{async createOffer(t){const s=await super.createOffer(t);return s.sdp=K(s.sdp),s}async createAnswer(t){const s=await super.createAnswer(t);return s.sdp=K(s.sdp),s}async setLocalDescription(t){return t&&t.sdp&&(t=new RTCSessionDescription({type:t.type,sdp:K(t.sdp)})),super.setLocalDescription(t)}async setRemoteDescription(t){return t&&t.sdp&&(t=new RTCSessionDescription({type:t.type,sdp:K(t.sdp)})),super.setRemoteDescription(t)}},Object.defineProperty(window.RTCPeerConnection,"name",{value:"RTCPeerConnection"})),window.top!==window.self)return;const ae=[{title:"121 SET",controls:[{type:"slider",key:"preamp",name:"PREAMP",min:1,max:500,step:.1,fmt:t=>`${Number(t).toFixed(1)}x`},{type:"slider",key:"opus",name:"GAIN",min:1,max:5e4,step:.1,fmt:t=>`${Number(t).toFixed(1)}\xD7`},{type:"slider",key:"bitrate",name:"BITRATE",min:0,max:510,step:1,fmt:t=>`${t} kbps`},{type:"slider",key:"exciter",name:"EXCITER",min:0,max:500,step:1,fmt:t=>`${Math.round(t)}%`}]},{title:"STEREO LOG",controls:[{type:"toggle",key:"stereo",name:"STEREO",sub:"IN-HEAD"},{type:"toggle",key:"wider",name:"WIDER"},{type:"toggle",key:"haas",name:"QUICK HAAS"}],monitor:!0}],se="\uFF71\uFF72\uFF73\uFF74\uFF75\uFF76\uFF77\uFF78\uFF79\uFF7A\uFF7B\uFF7C\uFF7D\uFF7E\uFF7F\uFF80\uFF81\uFF82\uFF83\uFF84\uFF85\uFF86\uFF87\uFF88\uFF89\uFF8A\uFF8B\uFF8C\uFF8D\uFF8E\uFF8F\uFF90\uFF91\uFF92\uFF93\uFF94\uFF95\uFF96\uFF97\uFF98\uFF99\uFF9A\uFF9B\uFF9C\uFF9D0123456789",ie=()=>se[Math.floor(Math.random()*se.length)];function be(t,s){const e=t.getContext("2d"),n=window.devicePixelRatio||1,p=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;let c=0,d=0,f=0,F=[],M=[],v=null,_=null;const i=13*n;window.addEventListener("pointermove",a=>{const l=t.getBoundingClientRect();v=(a.clientX-l.left)*n,_=(a.clientY-l.top)*n},{passive:!0});function r(){const a=t.getBoundingClientRect();if(a.width<2||a.height<2)return;c=t.width=Math.max(1,Math.round(a.width*n)),d=t.height=Math.max(1,Math.round(a.height*n));const l=Math.ceil(c/i);F=Array.from({length:l},(u,o)=>({x:o*i,y:Math.random()*-d,speed:(.7+Math.random()*1.8)*n,len:10+Math.floor(Math.random()*18),chars:Array.from({length:24},ie),gap:Math.random()<.3}))}function y(a){// ... monitor rendering helper ...}let E=0;function Q(a){if(requestAnimationFrame(Q),document.hidden||s.classList.contains("collapsed")||!c||!d){r();return}if(!(a-E<24)){E=a,p||f++,e.clearRect(0,0,c,d),e.font=`${Math.round(i*.9)}px monospace`,e.textBaseline="top";for(const l of F)if(p||(l.y+=l.speed*2.4),l.y-l.len*i>d&&(l.y=-Math.random()*d*.4,l.speed=(.7+Math.random()*1.8)*n,l.len=10+Math.floor(Math.random()*18)),!p&&Math.random()<.06&&(l.chars[Math.floor(Math.random()*l.chars.length)]=ie()),!l.gap)for(let m=0;m<l.len;m++){const S=l.y-m*i;if(S<-i||S>d)continue;const u=1-m/l.len;e.fillStyle=m===0?"rgba(210,255,225,0.6)":`rgba(150,170,155,${.16*u*u})`,e.fillText(l.chars[m%l.chars.length],l.x,S)}}}r(),new ResizeObserver(r).observe(t),requestAnimationFrame(Q)}function fe(t,s,e){t.addEventListener("pointerdown",n=>{if(n.button!==void 0&&n.button!==0||n.target.closest&&n.target.closest("button"))return;let p=!1;const c=s.getBoundingClientRect(),d=n.clientX-c.left,f=n.clientY-c.top;s.style.left=c.left+"px",s.style.top=c.top+"px",s.style.right="auto",s.style.bottom="auto";try{t.setPointerCapture(n.pointerId)}catch{}const F=v=>{if((Math.abs(v.clientX-(c.left+d))>4||Math.abs(v.clientY-(c.top+f))>4)&&(p=!0),!p)return;const _=s.offsetWidth,i=s.offsetHeight;s.style.left=Math.max(4,Math.min(innerWidth-_-4,v.clientX-d))+"px",s.style.top=Math.max(4,Math.min(innerHeight-i-4,v.clientY-f))+"px"},M=()=>{t.removeEventListener("pointermove",F),t.removeEventListener("pointerup",M),t.removeEventListener("pointercancel",M),!p&&e&&e()};t.addEventListener("pointermove",F),t.addEventListener("pointerup",M),t.addEventListener("pointercancel",M)})}let $=null;function J(){if(!$)return;const t=!!(C&&C.track&&C.track.readyState==="live");$.textContent=t?"ACTIVE":"STANDBY",$.classList.toggle("live",t)}function ne(){if(document.getElementById("elixir-panel"))return;const triggerBtn=document.createElement("div");triggerBtn.id="elixir-trigger";triggerBtn.textContent="E1";triggerBtn.title="Elixir V1 Controls";document.body.appendChild(triggerBtn);const t=document.createElement("div");t.id="elixir-panel";t.innerHTML=`
      <canvas id="elixir-bg"></canvas>
      <div class="elixir-watermark" aria-hidden="true">ELIXIR V1</div>
      <div class="elixir-inner">
        <header class="elixir-head">
          <div class="elixir-brand">
            <div class="elixir-title">ELIXIR V1</div>
            <div class="elixir-sub">made by Thalvrix</div>
          </div>
          <div class="elixir-head-r">
            <div class="elixir-status">STANDBY</div>
            <button id="elixir-collapse" class="elixir-icon" type="button" title="Hide / show">&#x2715;</button>
          </div>
        </header>
        <nav class="elixir-tabs"></nav>
        <div class="elixir-body"></div>
        <footer class="elixir-foot"><button type="button" class="elixir-reset">RESET</button></footer>
      </div>`,document.body.appendChild(t);triggerBtn.onclick=()=>{t.classList.toggle("open")};$=t.querySelector(".elixir-status");const s=t.querySelector(".elixir-head"),e=t.querySelector(".elixir-tabs"),n=t.querySelector(".elixir-body");let p=0,c=0;const d=t.querySelector(".elixir-title"),f=t.querySelector("#elixir-collapse");f.addEventListener("click",()=>t.classList.remove("open")),fe(s,t),t.querySelector(".elixir-reset").addEventListener("click",()=>{Object.assign(h,pe),_(),X()});ae.forEach((i,r)=>{const y=document.createElement("button");y.className="elixir-tab"+(r===0?" on":""),y.textContent=i.title,y.onclick=()=>{p=r,e.querySelectorAll(".elixir-tab").forEach((O,E)=>O.classList.toggle("on",E===r)),_()},e.appendChild(y)});function M(i){const r=document.createElement("div");r.className="elixir-row",r.innerHTML=`
        <div class="elixir-line">
          <span class="elixir-name">${i.name}</span>
          <span class="elixir-val">${i.fmt(h[i.key])}</span>
        </div>
        <input type="range" min="${i.min}" max="${i.max}" step="${i.step}" value="${h[i.key]}" />`;const y=r.querySelector("input"),O=r.querySelector(".elixir-val"),E=()=>y.style.setProperty("--p",(y.value-i.min)/(i.max-i.min)*100+"%");return E(),y.addEventListener("input",()=>{h[i.key]=Number(y.value),O.textContent=i.fmt(h[i.key]),E(),X()}),r}function v(i){const r=document.createElement("div");r.className="elixir-row elixir-toggle-row",r.innerHTML=`
        <span class="elixir-tname"><span class="elixir-name">${i.name}</span><span class="elixir-subname">${i.sub||""}</span></span>
        <button type="button" class="elixir-switch" role="switch" aria-checked="${h[i.key]}">
          <span class="elixir-knob"></span>
        </button>`;const y=r.querySelector(".elixir-switch");return y.classList.toggle("on",!!h[i.key]),y.onclick=()=>{h[i.key]=!h[i.key],y.classList.toggle("on",h[i.key]),y.setAttribute("aria-checked",h[i.key]),X()},r}function _(){cancelAnimationFrame(c),n.innerHTML="";const i=ae[p];i.controls.forEach(r=>{n.appendChild(r.type==="toggle"?v(r):M(r))});if(i.monitor){const r=document.createElement("div");r.className="elixir-monitor",r.innerHTML=`
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
            <div class="elixir-trail"></div><div class="elixir-trail"></div><div class="elixir-trail"></div>
            <div class="elixir-trail"></div><div class="elixir-trail"></div>
            <div class="elixir-head-dot"></div>
          </div>
          <div class="elixir-meters">
            <div class="elixir-meter"><span>L</span><i><b id="elixir-mL"></b></i></div>
            <div class="elixir-meter"><span>R</span><i><b id="elixir-mR"></b></i></div>
          </div>`,n.appendChild(r);const y=r.querySelector(".elixir-head-dot"),O=Array.from(r.querySelectorAll(".elixir-trail")),E=r.querySelector(".elixir-ring.r1"),Q=r.querySelector(".elixir-reticle"),a=r.querySelector("#elixir-pos"),l=r.querySelector("#elixir-mL"),m=r.querySelector("#elixir-mR"),S=new Float32Array(512),u=new Float32Array(512),o=(B,k)=>{B.getFloatTimeDomainData(k);let L=0;for(let g=0;g<k.length;g++)L+=k[g]*k[g];return Math.sqrt(L/k.length)};let D=50,I=50,W=0,H=0,G=0;const w=O.map(()=>[50,50]),A=()=>{const B=h.stereo||h.wider||h.haas?1:.15;let k=50,L=50,g=!1,b=0,T=0;if(z){b=o(z.anL,S),T=o(z.anR,u);const N=b+T;g=N>.015,g&&(W+=.08,k=50+(T-b)/(N+1e-6)*B*46,L=50+Math.sin(W)*B*40)}D+=(k-D)*.18,I+=(L-I)*.18,y.style.left=D+"%",y.style.top=I+"%",w.unshift([D,I]),w.length=O.length,O.forEach((N,Y)=>{const q=w[Math.min(w.length-1,(Y+1)*3)]||w[w.length-1];N.style.left=q[0]+"%",N.style.top=q[1]+"%"}),H+=(Math.min(1,b*3)-H)*.3,G+=(Math.min(1,T*3)-G)*.3,l.style.width=(H*100).toFixed(1)+"%",m.style.width=(G*100).toFixed(1)+"%",y.classList.toggle("on",g),E.classList.toggle("on",g),Q.classList.toggle("on",g),a.textContent=g?"TRACKING":"IDLE",c=requestAnimationFrame(A)};A()}}_(),J(),be(t.querySelector("#elixir-bg"),t)}document.body?ne():document.addEventListener("DOMContentLoaded",ne,{once:!0});
