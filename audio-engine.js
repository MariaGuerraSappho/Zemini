/**
 * Updated AudioEngine with pressure matrix control, Web Audio API effects,
 * and visual cell feedback.
 */

export class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.microphone = null;
        this.masterGain = null;
        this.effectsInput = null;
        this.effectsOutput = null;

        this.effectNodes = {};
        this.webAudioEffects = {};

        this.recordedChunks = [];
        this.mediaRecorder = null;
        this.performanceRecorder = null;

        this.currentSources = [];
        this.activeLoopedSources = new Map(); // gridIndex -> { source, dryGain, wetGain }

        this.gridState = Array.from({ length: 10 }, () => Array(10).fill(false));

        // Create audio context immediately but it will be in 'suspended' state
        this.initializeAudioContext();
    }

    async initialize() {
        console.log("AudioEngine base initialized. Ready to load effects after user gesture.");
    }

    async initializeAudioContext() {
        try {
            if (this.audioContext && this.audioContext.state !== 'closed') return;

            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 44100,
                latencyHint: 'interactive'
            });

            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = 0.8;
            this.masterGain.connect(this.audioContext.destination);

            this.createEffectsChain();
            console.log("Audio context created in suspended state.");
            
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
                console.log("AudioContext resumed successfully.");
            }

        } catch (error) {
            console.error("Failed to initialize AudioContext:", error);
            throw error;
        }
    }

    createEffectsChain() {
        this.effectsInput = this.audioContext.createGain();
        this.effectsOutput = this.audioContext.createGain();
        this.effectsOutput.connect(this.masterGain);
    }

    async loadAllRNBOEffects() {
        console.log("Loading Web Audio API effects instead of RNBO...");
        
        try {
            const context = this.audioContext;
            if (context.state === 'suspended') {
                await context.resume();
                console.log("AudioContext resumed successfully.");
            }

            // Create simple Web Audio API effects
            this.createWebAudioEffects();
            console.log("✓ All Web Audio effects loaded successfully.");
        } catch (error) {
            console.error("❌ Failed to load effects:", error);
            throw error;
        }
    }

    createWebAudioEffects() {
        const effects = ['pitchshifter', 'ringmod', 'freezer', 'vibrato', 'filterdelay', 'octaver'];
        
        effects.forEach(effectName => {
            this.webAudioEffects[effectName] = {
                active: false,
                nodes: this.createEffectNodes(effectName)
            };
        });
    }

    createEffectNodes(effectName) {
        const context = this.audioContext;
        const nodes = {};

        switch (effectName) {
            case 'pitchshifter':
                // More dramatic pitch shift with wider delay times and higher feedback
                nodes.input = context.createGain();
                nodes.delay1 = context.createDelay(0.2);
                nodes.delay2 = context.createDelay(0.2);
                nodes.delay1.delayTime.value = 0.015; // Much higher pitch
                nodes.delay2.delayTime.value = 0.12; // Much lower pitch
                nodes.feedback1 = context.createGain();
                nodes.feedback2 = context.createGain();
                nodes.feedback1.gain.value = 0.6; // Higher feedback for more obvious effect
                nodes.feedback2.gain.value = 0.5;
                nodes.mixer = context.createGain();
                nodes.output = context.createGain();
                nodes.output.gain.value = 1.2; // Louder output
                
                // Create pitch shifting network
                nodes.input.connect(nodes.delay1);
                nodes.input.connect(nodes.delay2);
                nodes.delay1.connect(nodes.feedback1);
                nodes.delay2.connect(nodes.feedback2);
                nodes.feedback1.connect(nodes.delay1);
                nodes.feedback2.connect(nodes.delay2);
                nodes.delay1.connect(nodes.mixer);
                nodes.delay2.connect(nodes.mixer);
                nodes.mixer.connect(nodes.output);
                break;

            case 'ringmod':
                // Ring modulation using oscillator
                nodes.input = context.createGain();
                nodes.oscillator = context.createOscillator();
                nodes.oscillator.frequency.value = 30;
                nodes.oscillator.type = 'sine';
                nodes.modGain = context.createGain();
                nodes.modGain.gain.value = 0;
                nodes.output = context.createGain();
                nodes.output.gain.value = 0.5;
                
                nodes.oscillator.connect(nodes.modGain.gain);
                nodes.input.connect(nodes.modGain);
                nodes.modGain.connect(nodes.output);
                nodes.oscillator.start();
                break;

            case 'freezer':
                // Reverb effect
                nodes.input = context.createGain();
                nodes.convolver = context.createConvolver();
                nodes.output = context.createGain();
                nodes.output.gain.value = 0.8;
                this.createReverbImpulse(nodes.convolver);
                
                nodes.input.connect(nodes.convolver);
                nodes.convolver.connect(nodes.output);
                break;

            case 'vibrato':
                // Vibrato using delay and LFO
                nodes.input = context.createGain();
                nodes.delay = context.createDelay(0.02);
                nodes.delay.delayTime.value = 0.01;
                nodes.lfo = context.createOscillator();
                nodes.lfoGain = context.createGain();
                nodes.lfo.frequency.value = 5;
                nodes.lfoGain.gain.value = 0.005;
                nodes.output = context.createGain();
                nodes.output.gain.value = 1.0;
                
                nodes.input.connect(nodes.delay);
                nodes.delay.connect(nodes.output);
                nodes.lfo.connect(nodes.lfoGain);
                nodes.lfoGain.connect(nodes.delay.delayTime);
                nodes.lfo.start();
                break;

            case 'filterdelay':
                // Filter + delay
                nodes.input = context.createGain();
                nodes.filter = context.createBiquadFilter();
                nodes.filter.type = 'lowpass';
                nodes.filter.frequency.value = 2000;
                nodes.delay = context.createDelay(0.3);
                nodes.delay.delayTime.value = 0.2;
                nodes.feedback = context.createGain();
                nodes.feedback.gain.value = 0.3;
                nodes.output = context.createGain();
                nodes.output.gain.value = 0.8;
                
                nodes.input.connect(nodes.filter);
                nodes.filter.connect(nodes.delay);
                nodes.delay.connect(nodes.output);
                nodes.delay.connect(nodes.feedback);
                nodes.feedback.connect(nodes.delay);
                break;
                
            case 'octaver':
                // Octave down effect using frequency division
                nodes.input = context.createGain();
                nodes.waveshaper = context.createWaveShaper();
                nodes.filter = context.createBiquadFilter();
                nodes.filter.type = 'lowpass';
                nodes.filter.frequency.value = 1000;
                nodes.output = context.createGain();
                nodes.output.gain.value = 0.8;
                
                this.createOctaveWaveShape(nodes.waveshaper);
                
                nodes.input.connect(nodes.waveshaper);
                nodes.waveshaper.connect(nodes.filter);
                nodes.filter.connect(nodes.output);
                break;
        }

        return nodes;
    }

    createReverbImpulse(convolver) {
        const length = this.audioContext.sampleRate * 2;
        const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
            }
        }
        
        convolver.buffer = impulse;
    }

    createOctaveWaveShape(waveshaper, type = 'normal') {
        const samples = 2048;
        const curve = new Float32Array(samples);
        
        for (let i = 0; i < samples; i++) {
            const x = (i - samples / 2) / (samples / 2);
            
            if (type === 'aggressive') {
                // More aggressive octave down with square wave characteristics
                curve[i] = x > 0 ? 0.7 : -0.7;
            } else if (type === 'sub') {
                // Sub-octave effect with frequency division simulation
                curve[i] = Math.sign(x) * Math.pow(Math.abs(x), 0.3) * 0.8;
            } else {
                // Original wave shaping
                curve[i] = Math.sign(x) * Math.pow(Math.abs(x), 0.5);
            }
        }
        
        waveshaper.curve = curve;
        waveshaper.oversample = '4x';
    }

    applyEffect(effectName, isActive) {
        const effect = this.webAudioEffects[effectName];
        if (!effect) {
            console.warn(`Effect '${effectName}' not found.`);
            return false;
        }

        try {
            if (isActive && !effect.active) {
                // Connect effect to the audio chain using designated input/output nodes
                const inputNode = effect.nodes.input;
                const outputNode = effect.nodes.output;
                
                if (inputNode && outputNode) {
                    this.effectsInput.connect(inputNode);
                    outputNode.connect(this.effectsOutput);
                    
                    effect.active = true;
                    console.log(`✓ Effect '${effectName}' activated.`);
                } else {
                    console.error(`Effect '${effectName}' missing input/output nodes`);
                    return false;
                }

            } else if (!isActive && effect.active) {
                // Disconnect effect from the audio chain
                const inputNode = effect.nodes.input;
                const outputNode = effect.nodes.output;
                
                try {
                    if (inputNode && outputNode) {
                        this.effectsInput.disconnect(inputNode);
                        outputNode.disconnect(this.effectsOutput);
                    }
                } catch (e) {
                    // This can throw if not connected, which is fine
                }
                
                effect.active = false;
                console.log(`✗ Effect '${effectName}' deactivated.`);
            }
            return true;
        } catch (error) {
            console.error(`Error applying effect ${effectName}:`, error);
            return false;
        }
    }

    getEffectParameter(effectName, paramId) {
        const effect = this.webAudioEffects[effectName];
        if (!effect || !effect.nodes) return 0;

        const nodes = effect.nodes;
        
        try {
            switch (effectName) {
                case 'pitchshifter':
                    if (paramId === 'delay1') return nodes.delay1 ? nodes.delay1.delayTime.value : 0.015;
                    if (paramId === 'delay2') return nodes.delay2 ? nodes.delay2.delayTime.value : 0.12;
                    if (paramId === 'feedback1') return nodes.feedback1 ? nodes.feedback1.gain.value : 0.6;
                    if (paramId === 'feedback2') return nodes.feedback2 ? nodes.feedback2.gain.value : 0.5;
                    if (paramId === 'output') return nodes.output ? nodes.output.gain.value : 1.2;
                    break;
                    
                case 'ringmod':
                    if (paramId === 'frequency') return nodes.oscillator ? nodes.oscillator.frequency.value : 30;
                    if (paramId === 'depth') return nodes.modGain ? nodes.modGain.gain.value : 0;
                    if (paramId === 'output') return nodes.output ? nodes.output.gain.value : 0.5;
                    break;
                    
                case 'freezer':
                    if (paramId === 'output') return nodes.output ? nodes.output.gain.value : 0.8;
                    break;
                    
                case 'vibrato':
                    if (paramId === 'rate') return nodes.lfo ? nodes.lfo.frequency.value : 5;
                    if (paramId === 'depth') return nodes.lfoGain ? nodes.lfoGain.gain.value : 0.005;
                    if (paramId === 'output') return nodes.output ? nodes.output.gain.value : 1.0;
                    break;
                    
                case 'filterdelay':
                    if (paramId === 'frequency') return nodes.filter ? nodes.filter.frequency.value : 2000;
                    if (paramId === 'delayTime') return nodes.delay ? nodes.delay.delayTime.value : 0.2;
                    if (paramId === 'feedback') return nodes.feedback ? nodes.feedback.gain.value : 0.3;
                    if (paramId === 'output') return nodes.output ? nodes.output.gain.value : 0.8;
                    break;
                    
                case 'octaver':
                    if (paramId === 'frequency') return nodes.filter ? nodes.filter.frequency.value : 1000;
                    if (paramId === 'output') return nodes.output ? nodes.output.gain.value : 0.8;
                    break;
            }
        } catch (error) {
            console.warn(`Error getting parameter ${paramId} for effect ${effectName}:`, error);
        }
        
        return 0;
    }

    setEffectParameter(effectName, paramId, value) {
        const effect = this.webAudioEffects[effectName];
        if (!effect || !effect.nodes) return false;

        const nodes = effect.nodes;
        
        try {
            switch (effectName) {
                case 'pitchshifter':
                    if (paramId === 'delay1' && nodes.delay1) nodes.delay1.delayTime.value = value;
                    if (paramId === 'delay2' && nodes.delay2) nodes.delay2.delayTime.value = value;
                    if (paramId === 'feedback1' && nodes.feedback1) nodes.feedback1.gain.value = value;
                    if (paramId === 'feedback2' && nodes.feedback2) nodes.feedback2.gain.value = value;
                    if (paramId === 'output' && nodes.output) nodes.output.gain.value = value;
                    break;
                    
                case 'ringmod':
                    if (paramId === 'frequency' && nodes.oscillator) nodes.oscillator.frequency.value = value;
                    if (paramId === 'depth' && nodes.modGain) nodes.modGain.gain.value = value;
                    if (paramId === 'output' && nodes.output) nodes.output.gain.value = value;
                    break;
                    
                case 'freezer':
                    if (paramId === 'output' && nodes.output) nodes.output.gain.value = value;
                    break;
                    
                case 'vibrato':
                    if (paramId === 'rate' && nodes.lfo) nodes.lfo.frequency.value = value;
                    if (paramId === 'depth' && nodes.lfoGain) nodes.lfoGain.gain.value = value;
                    if (paramId === 'output' && nodes.output) nodes.output.gain.value = value;
                    break;
                    
                case 'filterdelay':
                    if (paramId === 'frequency' && nodes.filter) nodes.filter.frequency.value = value;
                    if (paramId === 'delayTime' && nodes.delay) nodes.delay.delayTime.value = value;
                    if (paramId === 'feedback' && nodes.feedback) nodes.feedback.gain.value = value;
                    if (paramId === 'output' && nodes.output) nodes.output.gain.value = value;
                    break;
                    
                case 'octaver':
                    if (paramId === 'frequency' && nodes.filter) nodes.filter.frequency.value = value;
                    if (paramId === 'output' && nodes.output) nodes.output.gain.value = value;
                    break;
            }
            return true;
        } catch (error) {
            console.warn(`Error setting parameter ${paramId} for effect ${effectName}:`, error);
            return false;
        }
    }

    isEffectActive(effectName) {
        const effect = this.webAudioEffects[effectName];
        return effect ? effect.active : false;
    }

    resetAllEffectParameters() {
        // Reset all effects to their default values
        Object.keys(this.webAudioEffects).forEach(effectName => {
            this.webAudioEffects[effectName].nodes = this.createEffectNodes(effectName);
        });
        console.log('All effect parameters reset to defaults');
    }

    async testEffect(effectName) {
        const effect = this.webAudioEffects[effectName];
        if (!effect) {
            console.error(`Effect '${effectName}' not found for testing.`);
            return false;
        }

        try {
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            
            oscillator.frequency.value = 440;
            oscillator.type = 'sine';
            gainNode.gain.value = 0.1;
            
            oscillator.connect(gainNode);
            
            const wasActive = effect.active;
            this.applyEffect(effectName, true);
            
            const dryGain = this.audioContext.createGain();
            dryGain.gain.value = 0.5;
            gainNode.connect(dryGain);
            dryGain.connect(this.masterGain);

            const wetGain = this.audioContext.createGain();
            wetGain.gain.value = 0.5;
            gainNode.connect(wetGain);
            wetGain.connect(this.effectsInput);
            
            oscillator.start();
            
            setTimeout(() => {
                oscillator.stop();
                if (!wasActive) {
                    this.applyEffect(effectName, false);
                }
            }, 500);
            
            console.log(`✓ Test tone played through ${effectName}`);
            return true;
            
        } catch (error) {
            console.error(`Error testing effect ${effectName}:`, error);
            return false;
        }
    }

    getEffectStatus() {
        const status = {};
        
        Object.entries(this.webAudioEffects).forEach(([name, effect]) => {
            status[name] = {
                active: effect.active,
                hasDevice: true,
                parameters: []
            };
        });
        
        return status;
    }

    async setupMicrophone(selectedDeviceId) {
        try {
            const constraints = {
                audio: selectedDeviceId ? { deviceId: selectedDeviceId } : true
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            stream.getTracks().forEach(track => track.stop());

            this.setupRecorder(stream);
            console.log("Microphone ready.");
        } catch (err) {
            console.error("Microphone setup error:", err);
        }
    }

    setupRecorder(stream) {
        this.mediaRecorder = new MediaRecorder(stream);

        this.mediaRecorder.ondataavailable = (e) => {
            this.recordedChunks.push(e.data);
        };

        this.mediaRecorder.onstop = () => {
            const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
            const url = URL.createObjectURL(blob);
            const sample = { url, name: `Recording ${Date.now()}` };

            this.recordedChunks = [];

            if (this.onRecordingComplete) {
                this.onRecordingComplete(sample);
            }
        };
    }

    async startRecording(deviceId) {
        try {
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            const constraints = {
                audio: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            const source = this.audioContext.createMediaStreamSource(stream);

            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            this.recordedChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                }
            };

            this.mediaRecorder.onerror = (event) => {
                console.error('MediaRecorder error:', event.error);
            };

            this.currentRecordingStream = stream;
            this.mediaRecorder.start();
            console.log('Recording started');
            
        } catch (error) {
            console.error('Error starting recording:', error);
            throw error;
        }
    }

    async stopRecording() {
        return new Promise((resolve, reject) => {
            this.debug('🛑 AudioEngine stopRecording called');
            
            if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                
                this.mediaRecorder.onstop = () => {
                    this.debug('🛑 MediaRecorder stopped, creating blob...');
                    const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
                    this.debug(`🛑 Blob created: ${blob.size} bytes, type: ${blob.type}`);
                    
                    this.recordedChunks = [];
                    
                    if (this.currentRecordingStream) {
                        this.currentRecordingStream.getTracks().forEach(track => track.stop());
                        this.currentRecordingStream = null;
                        this.debug('🛑 Recording stream cleaned up');
                    }
                    
                    resolve(blob);
                };
                
                this.mediaRecorder.stop();
                this.debug('🛑 MediaRecorder.stop() called');

            } else {
                this.debug(`🛑 stopRecording called but mediaRecorder is not in recording state. State: ${this.mediaRecorder ? this.mediaRecorder.state : 'null'}`);
                resolve(null);
            }
        });
    }

    async playSample(audioBlob, volume = 1.0, loop = false) {
        try {
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            const source = this.audioContext.createBufferSource();
            const gainNode = this.audioContext.createGain();
            
            source.buffer = audioBuffer;
            source.loop = loop;
            gainNode.gain.value = volume;
            
            source.connect(gainNode);
            gainNode.connect(this.masterGain);
            
            source.start();
            
            this.currentSources.push(source);
            
            return source;
        } catch (error) {
            console.error('Error playing sample:', error);
            throw error;
        }
    }

    /**
     * @deprecated This function is complex and unreliable for performance mode.
     * Use startLoopedSampleWithEffect and stopLoopedSampleWithEffect instead.
     */
    async playSampleWithEffect(audioBlob, effectName, volume = 1.0, loop = false) {
        console.warn("playSampleWithEffect is deprecated. Use startLoopedSampleWithEffect for performance mode.");
        return this.startLoopedSampleWithEffect(-1, audioBlob, effectName, volume); // -1 for non-grid-cell
    }

    stopSample(source) {
        try {
            source.stop();
            const index = this.currentSources.indexOf(source);
            if (index > -1) {
                this.currentSources.splice(index, 1);
            }
        } catch (error) {
            console.error('Error stopping sample:', error);
        }
    }

    async startLoopedSampleWithEffect(gridIndex, audioBlob, effectName, volume = 1.0) {
        if (this.activeLoopedSources.has(gridIndex)) {
            this.stopLoopedSampleWithEffect(gridIndex);
        }

        try {
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            console.log(`Starting looped sample for grid ${gridIndex}, blob size: ${audioBlob.size} bytes`);

            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            console.log(`Audio buffer decoded: duration=${audioBuffer.duration}s, sampleRate=${audioBuffer.sampleRate}, channels=${audioBuffer.numberOfChannels}`);

            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.loop = true;
            
            // Set explicit loop points to ensure seamless looping
            source.loopStart = 0;
            source.loopEnd = audioBuffer.duration;

            const mainGain = this.audioContext.createGain();
            mainGain.gain.value = volume;

            const dryGain = this.audioContext.createGain();
            const wetGain = this.audioContext.createGain();

            // Connect the audio chain
            source.connect(mainGain);
            mainGain.connect(dryGain);
            
            // Dry signal goes directly to output
            dryGain.connect(this.masterGain);
            
            // If effectName is null (effects disabled), route all signal through dry path
            if (effectName === null) {
                dryGain.gain.value = 1.0;
                wetGain.gain.value = 0.0;
                console.log(`✓ Playing sample dry (no effects) for grid ${gridIndex}`);
            } else {
                dryGain.gain.value = 0.3;
                wetGain.gain.value = 0.7;
                
                // Connect wet signal through effects
                mainGain.connect(wetGain);
                wetGain.connect(this.effectsInput);

                // Activate the effect before starting playback
                const effectActivated = this.applyEffect(effectName, true);
                if (!effectActivated) {
                    console.warn(`Failed to activate effect ${effectName}, playing dry signal only`);
                    dryGain.gain.value = 1.0;
                    wetGain.gain.value = 0.0;
                }
            }
            
            // Add event listeners for debugging
            source.onended = () => {
                console.log(`Source ended for grid ${gridIndex} (this should not happen with looping)`);
            };
            
            source.start(0);
            console.log(`✓ Source started for grid ${gridIndex}, should be looping indefinitely`);

            this.activeLoopedSources.set(gridIndex, { source, effectName, dryGain, wetGain });
            console.log(`✓ Started looped sample for grid ${gridIndex} with ${effectName ? 'effect ' + effectName : 'no effects'}`);
            return true;

        } catch (error) {
            console.error(`Error starting looped sample for grid ${gridIndex}:`, error);
            if (effectName) {
                this.applyEffect(effectName, false);
            }
            return false;
        }
    }

    stopLoopedSampleWithEffect(gridIndex) {
        if (this.activeLoopedSources.has(gridIndex)) {
            const { source, effectName, dryGain, wetGain } = this.activeLoopedSources.get(gridIndex);
            
            console.log(`Stopping looped sample for grid ${gridIndex}`);
            
            try {
                // Stop the source with a short fade to avoid clicks
                if (source && source.context.state !== 'closed') {
                    source.stop(0);
                }
                
                // Disconnect all nodes
                if (source) source.disconnect();
                if (dryGain) dryGain.disconnect();
                if (wetGain) wetGain.disconnect();
            } catch(e) {
                console.warn(`Error stopping source for grid ${gridIndex}:`, e);
            }

            // Only deactivate effect if no other sources are using it
            const othersUsingEffect = Array.from(this.activeLoopedSources.values())
                .filter(active => active.effectName === effectName).length;
            
            if (othersUsingEffect <= 1) { // <= 1 because we're about to delete this one
                this.applyEffect(effectName, false);
                console.log(`Deactivated effect ${effectName} (no other sources using it)`);
            } else {
                console.log(`Keeping effect ${effectName} active (${othersUsingEffect - 1} other sources using it)`);
            }
            
            this.activeLoopedSources.delete(gridIndex);
            console.log(`✓ Stopped looped sample for grid ${gridIndex}`);
        } else {
            console.log(`No active looped source found for grid ${gridIndex}`);
        }
    }

    async startPerformanceRecording() {
        try {
            // Create a destination for recording the master output
            const dest = this.audioContext.createMediaStreamDestination();
            this.masterGain.connect(dest);
            
            const mediaRecorder = new MediaRecorder(dest.stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            const chunks = [];
            
            mediaRecorder.ondataavailable = (event) => {
                chunks.push(event.data);
            };
            
            mediaRecorder.start();

            // Return a promise that resolves with the final blob
            const recordingPromise = new Promise((resolve) => {
                mediaRecorder.onstop = () => {
                    const blob = new Blob(chunks, { type: 'audio/webm' });
                    // Disconnect the recorder from the master gain to stop capturing
                    this.masterGain.disconnect(dest);
                    resolve(blob);
                };
            });
                
            this.performanceRecorder = mediaRecorder;
            return recordingPromise;

        } catch (error) {
            console.error('Error starting performance recording:', error);
            throw error;
        }
    }

    async stopPerformanceRecording() {
        return new Promise((resolve) => {
            if (this.performanceRecorder && this.performanceRecorder.state === 'recording') {
                // The onstop handler (which resolves the promise) is already set up in startPerformanceRecording
                this.performanceRecorder.stop();
                resolve(); // Resolve this method's promise immediately
            } else {
                resolve();
            }
        });
    }

    handleMatrixInput(matrix) {
        const threshold = 50;

        for (let row = 0; row < 10; row++) {
            for (let col = 0; col < 10; col++) {
                const pressure = matrix[row][col];
                const isPressed = pressure > threshold;
                const wasPressed = this.gridState[row][col];

                const index = row * 10 + col;
                const cellEl = document.querySelector(`.grid-cell[data-index='${index}']`);
                const effectName = cellEl?.querySelector('.cell-title')?.textContent?.toLowerCase().replace(/ /g, '');

                if (isPressed && !wasPressed) {
                    if (effectName && this.webAudioEffects[effectName]) {
                        this.applyEffect(effectName, true);
                        console.log(`Activated effect: ${effectName}`);
                    }
                    cellEl?.classList.add('active');
                } else if (!isPressed && wasPressed) {
                    this.clearEffects();
                    cellEl?.classList.remove('active');
                }

                this.gridState[row][col] = isPressed;
            }
        }
    }

    clearEffects() {
        this.effectsInput.disconnect();
        for (let key in this.effectNodes) {
            try {
                this.effectNodes[key].disconnect();
            } catch (e) {}
        }
        // Also deactivate all RNBO effects
        Object.keys(this.rnboEffects).forEach(effectName => {
            this.applyEffect(effectName, false);
        });

        this.effectsInput.connect(this.effectsOutput);
        console.log("Effects cleared.");
    }

    debug(message) {
        console.log(message);
    }
}