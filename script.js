import { AudioEngine } from './audio-engine.js';
import { SerialHandler } from './serial-handler.js';

class AudioRugApp {
    constructor() {
        // RNBO object is attached to window by an inline script in index.html
        this.audioEngine = new AudioEngine();
        this.serialHandler = new SerialHandler();
        this.currentMode = 'RECORD';
        this.isPerformanceRecording = false;
        this.samples = [];
        this.lastPressureState = false;
        this.performanceRecordingBlob = null;
        this.microphoneStream = null;
        this.volumeAnalyzer = null;
        this.volumeMonitoringActive = false;
        
        // Effects toggle state
        this.effectsEnabled = true;
        
        // --- Recording State ---
        this.recordingState = 'idle'; // 'idle', 'recording'
        this.isRecordingOnCooldown = false;
        this.recordingCooldownMs = 1500; // 1.5 seconds between recording actions
        this.recordingReady = false; // Start NOT ready - require mat to be unpressed first
        
        // --- Configurable Sensitivity ---
        this.pressureThreshold = 25; // Single configurable threshold for both modes
        
        // --- Performance State ---
        this.gridCellPressureState = new Array(9).fill(false);
        this.activeSampleSources = new Map(); // Track active sample sources for each grid cell
        
        // Add initialization for debounce timers
        this.gridCellDebounceTimers = new Array(9).fill(null);
        this.pressureDebounceMs = 50; // 50ms debounce for pressure changes
        
        // Add debug tracking variable
        this.lastTotalPressure = 0;
        
        this.initializeElements();
        this.setupEventListeners();
        
        this.debug('Audio Rug App constructed, awaiting initialization.');
        this.preInitializeApp();
    }

    async preInitializeApp() {
        try {
            this.updateLoadingStatus('Waiting for user interaction...');
            // Show the start button
            this.startAppBtn.style.display = 'block';
        } catch (error) {
            this.updateLoadingStatus('Error during pre-initialization. Please refresh.', true);
            console.error("Pre-initialization failed:", error);
            this.debug('Pre-initialization failed:', error);
        }
    }

    async completeInitialization() {
        this.startAppBtn.disabled = true;
        this.startAppBtn.textContent = 'Loading...';

        try {
            this.updateLoadingStatus('Initializing Audio Context...');
            await this.audioEngine.initializeAudioContext();
            
            this.updateLoadingStatus('Loading Audio Effects...');
            await this.audioEngine.loadAllRNBOEffects();
            this.updateLoadingStatus('Audio Engine ready.');
            
            this.updateLoadingStatus('Requesting microphone access...');
            await this.requestMicrophonePermission();
            
            this.loadSamples();
            this.setupGrid();
            this.setupEffectsControls();
            
            this.hideLoadingOverlay();
            this.debug('Audio Rug App initialized successfully');
        } catch (error) {
            this.updateLoadingStatus(`Error: ${error.message}. Please refresh.`, true);
            this.startAppBtn.style.display = 'none';
            console.error("Initialization failed:", error);
            this.debug('Initialization failed:', error);
        }
    }

    initializeApp() {
        // This method is deprecated in favor of preInitializeApp and completeInitialization
        console.warn("initializeApp is deprecated");
    }

    initializeElements() {
        // Loading overlay
        this.loadingOverlay = document.getElementById('loadingOverlay');
        this.loadingStatus = document.getElementById('loadingStatus');
        this.startAppBtn = document.getElementById('startAppBtn');

        // Mode buttons
        this.recordModeBtn = document.getElementById('recordModeBtn');
        this.performModeBtn = document.getElementById('performModeBtn');
        
        // Connection
        this.connectBtn = document.getElementById('connectBtn');
        this.statusText = document.getElementById('statusText');
        
        // Sensitivity control
        this.sensitivitySlider = document.getElementById('sensitivitySlider');
        this.sensitivityValue = document.getElementById('sensitivityValue');
        
        // Sensor displays
        this.pressureValue = document.getElementById('pressureValue');
        this.xValue = document.getElementById('xValue');
        this.yValue = document.getElementById('yValue');
        
        // Record mode
        this.recordMode = document.getElementById('recordMode');
        this.performMode = document.getElementById('performMode');
        this.microphoneSelect = document.getElementById('microphoneSelect');
        this.recordBtn = document.getElementById('recordBtn');
        this.samplesContainer = document.getElementById('samplesContainer');
        this.clearSamplesBtn = document.getElementById('clearSamplesBtn');
        
        // Perform mode
        this.performRecordBtn = document.getElementById('performRecordBtn');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.performGrid = document.getElementById('performGrid');
        
        // Effects toggle
        this.effectsToggleBtn = document.getElementById('effectsToggleBtn');
        
        // Debug
        this.debugToggle = document.getElementById('debugToggle');
        this.debugPanel = document.getElementById('debugPanel');
        this.debugLog = document.getElementById('debugLog');
        this.effectsDebugToggle = document.getElementById('effectsDebugToggle');
        this.effectsDebugPanel = document.getElementById('effectsDebugPanel');
        this.effectsDebugContent = document.getElementById('effectsDebugContent');
        this.refreshEffectsDebug = document.getElementById('refreshEffectsDebug');
        
        // Effect Controls
        this.effectsControlToggle = document.getElementById('effectsControlToggle');
        this.effectsControlPanel = document.getElementById('effectsControlPanel');
        this.effectsControlContent = document.getElementById('effectsControlContent');
        this.resetEffectsBtn = document.getElementById('resetEffectsBtn');
        
        this.volumeBar = document.getElementById('volumeBar');

        // Set initial state
        this.debugPanel.classList.remove('active'); // Start with debug panel closed
        
        // Set initial record button text
        this.recordBtn.textContent = 'Press to record';
    }

    updateLoadingStatus(message, isError = false) {
        if (this.loadingStatus) {
            this.loadingStatus.textContent = message;
            if (isError) {
                this.loadingStatus.style.color = '#f44336';
            }
        }
    }

    hideLoadingOverlay() {
        if (this.loadingOverlay) {
            this.loadingOverlay.style.display = 'none';
        }
    }

    setupEventListeners() {
        // App start
        this.startAppBtn.addEventListener('click', () => this.completeInitialization());

        // Mode switching
        this.recordModeBtn.addEventListener('click', () => this.switchMode('RECORD'));
        this.performModeBtn.addEventListener('click', () => this.switchMode('PERFORM'));
        
        // Sensitivity control
        this.sensitivitySlider.addEventListener('input', (e) => this.updateSensitivity(parseInt(e.target.value)));
        
        // Connection
        this.connectBtn.addEventListener('click', () => {
            if (this.serialHandler.isConnected) {
                this.serialHandler.disconnect();
            } else {
                this.connectArduino();
            }
        });
        
        // Recording
        this.recordBtn.addEventListener('click', () => this.handleManualRecordToggle());
        this.clearSamplesBtn.addEventListener('click', () => this.clearSamples());
        
        // Sample controls event delegation
        this.samplesContainer.addEventListener('click', (e) => {
            const button = e.target.closest('[data-action]');
            if (!button) return;
            
            const action = button.dataset.action;
            const sampleId = parseInt(button.dataset.sampleId);
            
            if (action === 'play') {
                this.playSample(sampleId);
            } else if (action === 'delete') {
                this.deleteSample(sampleId);
            }
        });
        
        // Performance
        this.performRecordBtn.addEventListener('click', () => this.togglePerformanceRecording());
        this.downloadBtn.addEventListener('click', () => this.downloadPerformance());
        
        // Effects toggle
        this.effectsToggleBtn.addEventListener('click', () => this.toggleEffects());
        
        // Debug
        this.debugToggle.addEventListener('click', () => this.toggleDebug());
        this.effectsDebugToggle.addEventListener('click', () => this.toggleEffectsDebug());
        this.effectsControlToggle.addEventListener('click', () => this.toggleEffectsControl());
        this.refreshEffectsDebug.addEventListener('click', () => this.refreshEffectsDebugPanel());
        this.resetEffectsBtn.addEventListener('click', () => this.resetAllEffects());
        
        // Serial data handling
        this.serialHandler.onDataReceived = (data) => this.handleSerialData(data);
        this.serialHandler.onConnectionChange = (connected) => this.handleConnectionChange(connected);
    }

    updateSensitivity(value) {
        this.pressureThreshold = value;
        this.sensitivityValue.textContent = value;
        this.debug(`Sensitivity updated to: ${value} (lower = more sensitive)`);
    }

    async requestMicrophonePermission() {
        try {
            // Request microphone permission first
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop()); // Stop immediately after permission
            this.debug('Microphone permission granted');
            
            // Now that we have permission, enumerate and set up devices
            this.updateLoadingStatus('Setting up microphones...');
            await this.setupMicrophones();
            this.updateLoadingStatus('Microphones configured.');

            // Add listener for microphone selection change
            this.microphoneSelect.addEventListener('change', () => this.onMicrophoneChange());
        } catch (error) {
            this.debug('Microphone permission denied:', error);
            // Propagate the error to be caught by completeInitialization
            throw new Error('Microphone permission is required for this app to function.');
        }
    }

    async setupMicrophones() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(device => device.kind === 'audioinput');
            
            this.microphoneSelect.innerHTML = '<option value="">Select Microphone</option>';
            
            if (audioInputs.length === 0) {
                this.debug('No audio input devices found');
                this.updateLoadingStatus('No microphones found. Recording will not work.', true);
                return; // Don't throw an error, but allow app to continue.
            }
            
            audioInputs.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Microphone ${device.deviceId.slice(0, 8)}`;
                this.microphoneSelect.appendChild(option);
            });
            
            // Auto-select first available microphone
            if (audioInputs.length > 0) {
                this.microphoneSelect.value = audioInputs[0].deviceId;
                await this.onMicrophoneChange();
            }
            
            this.debug(`Found ${audioInputs.length} audio input devices`);
        } catch (error) {
            this.debug('Error enumerating microphones:', error);
            throw new Error('Could not enumerate microphones.');
        }
    }

    async onMicrophoneChange() {
        const deviceId = this.microphoneSelect.value;
        
        // Stop existing volume monitoring
        this.stopVolumeMonitoring();
        
        if (deviceId) {
            try {
                // Ensure audio context is running
                if (this.audioEngine.audioContext.state === 'suspended') {
                    await this.audioEngine.audioContext.resume();
                    this.debug('🎵 Audio context resumed');
                }
                
                // Get new stream for selected microphone
                this.microphoneStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        deviceId: { exact: deviceId },
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                        sampleRate: 44100,
                        channelCount: 1
                    }
                });
                
                this.startVolumeMonitoring();
                this.debug(`Microphone changed to: ${this.microphoneSelect.options[this.microphoneSelect.selectedIndex].text}`);
            } catch (error) {
                this.debug('Error accessing selected microphone:', error);
                alert('Error accessing the selected microphone. Please try another one.');
            }
        } else {
            this.volumeBar.style.width = '0%';
        }
    }

    startVolumeMonitoring() {
        if (!this.microphoneStream || this.volumeMonitoringActive) return;
        
        try {
            const audioContext = this.audioEngine.audioContext;
            
            // Ensure audio context is running
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }
            
            const source = audioContext.createMediaStreamSource(this.microphoneStream);
            
            this.volumeAnalyzer = audioContext.createAnalyser();
            this.volumeAnalyzer.fftSize = 256;
            this.volumeAnalyzer.smoothingTimeConstant = 0.8;
            
            source.connect(this.volumeAnalyzer);
            
            this.volumeMonitoringActive = true;
            this.updateVolumeDisplay();
            
            this.debug('Volume monitoring started');
        } catch (error) {
            this.debug('Error starting volume monitoring:', error);
        }
    }

    stopVolumeMonitoring() {
        this.volumeMonitoringActive = false;
        
        if (this.microphoneStream) {
            this.microphoneStream.getTracks().forEach(track => track.stop());
            this.microphoneStream = null;
        }
        
        if (this.volumeAnalyzer) {
            this.volumeAnalyzer.disconnect();
            this.volumeAnalyzer = null;
        }
        
        this.volumeBar.style.width = '0%';
        this.debug('Volume monitoring stopped');
    }

    updateVolumeDisplay() {
        if (!this.volumeMonitoringActive || !this.volumeAnalyzer) return;
        
        const bufferLength = this.volumeAnalyzer.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        this.volumeAnalyzer.getByteFrequencyData(dataArray);
        
        // Calculate average volume
        const average = dataArray.reduce((acc, val) => acc + val, 0) / bufferLength;
        const percentage = (average / 255) * 100;
        
        // Update volume bar
        this.volumeBar.style.width = `${Math.min(percentage, 100)}%`;
        
        // Continue monitoring
        requestAnimationFrame(() => this.updateVolumeDisplay());
    }

    loadSamples() {
        // Clear any stale samples from localStorage since blobs don't persist between sessions
        localStorage.removeItem('audioRugSamples');
        this.samples = [];
        this.updateSamplesList();
        this.debug('Cleared stale samples from localStorage');
    }

    saveSamples() {
        // Convert samples to serializable format
        const serializableSamples = this.samples.map(sample => ({
            id: sample.id,
            name: sample.name,
            duration: sample.duration,
            timestamp: sample.timestamp,
            // Convert blob to base64 for storage
            blobData: null // We'll handle this separately
        }));
        
        // Store metadata only for now
        localStorage.setItem('audioRugSamples', JSON.stringify(serializableSamples));
        
        // Store blobs separately using IndexedDB if available
        this.storeBlobsInIndexedDB();
    }

    async storeBlobsInIndexedDB() {
        try {
            // Simple blob storage - in a real app you'd use IndexedDB
            // For now, we'll keep blobs in memory only
            this.debug('Samples stored in memory');
        } catch (error) {
            this.debug('Error storing blobs:', error);
        }
    }

    setupGrid() {
        const cells = this.performGrid.querySelectorAll('.grid-cell');
        cells.forEach((cell, index) => {
            // Remove the old click handler and add mouse hold functionality
            cell.addEventListener('mousedown', (e) => {
                e.preventDefault();
                if (this.currentMode === 'PERFORM') {
                    this.handleGridCellPressureChange(index, true, 100);
                    cell.dataset.mousePressed = 'true';
                }
            });
            
            cell.addEventListener('mouseup', (e) => {
                e.preventDefault();
                if (this.currentMode === 'PERFORM' && cell.dataset.mousePressed === 'true') {
                    this.handleGridCellPressureChange(index, false, 0);
                    cell.dataset.mousePressed = 'false';
                }
            });
            
            cell.addEventListener('mouseleave', (e) => {
                if (this.currentMode === 'PERFORM' && cell.dataset.mousePressed === 'true') {
                    this.handleGridCellPressureChange(index, false, 0);
                    cell.dataset.mousePressed = 'false';
                }
            });
            
            // Prevent context menu on right click
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
            });

            // Add drag and drop functionality
            this.setupDragAndDrop(cell, index);
        });
        
        // Update sample titles
        this.updateGridSampleTitles();

        // Setup effect items drag functionality
        this.setupEffectsDrag();
    }

    setupDragAndDrop(cell, index) {
        // Allow dropping on grid cells
        cell.addEventListener('dragover', (e) => {
            e.preventDefault();
            cell.classList.add('drag-over');
        });

        cell.addEventListener('dragleave', (e) => {
            e.preventDefault();
            cell.classList.remove('drag-over');
        });

        cell.addEventListener('drop', (e) => {
            e.preventDefault();
            cell.classList.remove('drag-over');
            
            const effectType = e.dataTransfer.getData('text/effect');
            if (effectType) {
                this.changeGridCellEffect(index, effectType);
            }
        });
    }

    setupEffectsDrag() {
        const effectItems = document.querySelectorAll('.effect-item');
        effectItems.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                const effectType = item.dataset.effect;
                e.dataTransfer.setData('text/effect', effectType);
                item.classList.add('dragging');
                this.debug(`Started dragging effect: ${effectType}`);
            });

            item.addEventListener('dragend', (e) => {
                item.classList.remove('dragging');
            });
        });
    }

    changeGridCellEffect(gridIndex, newEffect) {
        const cell = this.performGrid.children[gridIndex];
        if (!cell) return;

        // Stop any currently playing sample on this cell
        if (this.activeSampleSources.has(gridIndex)) {
            this.stopSampleWithEffect(gridIndex);
        }

        // Update the cell's effect data
        cell.dataset.effect = newEffect;
        
        // Update the visual display
        const effectElement = cell.querySelector('.cell-effect');
        if (effectElement) {
            effectElement.textContent = this.formatEffectName(newEffect);
        }

        // Add visual feedback
        cell.classList.add('effect-changed');
        setTimeout(() => {
            cell.classList.remove('effect-changed');
        }, 500);

        this.debug(`Changed grid cell ${gridIndex} effect to: ${newEffect}`);
    }

    formatEffectName(effectType) {
        const effectNames = {
            'pitchshifter': 'Pitch Shifter',
            'ringmod': 'Ring Mod',
            'freezer': 'Freezer',
            'vibrato': 'Vibrato',
            'filterdelay': 'Filter Delay',
            'octaver': 'Octaver'
        };
        return effectNames[effectType] || effectType;
    }

    updateGridSampleTitles() {
        // Update all cells to show current sample names and dynamically assign sample indices
        const cells = this.performGrid.querySelectorAll('.grid-cell');
        cells.forEach((cell, gridIndex) => {
            const titleElement = cell.querySelector('.cell-title');
            
            // Dynamically assign sample indices based on available samples
            let sampleIndex;
            if (this.samples.length >= 9) {
                // If we have 9 or more samples, use samples 0-8 directly
                sampleIndex = gridIndex;
            } else if (this.samples.length > 3) {
                // If we have 4-8 samples, use available samples and then cycle through them
                sampleIndex = gridIndex < this.samples.length ? gridIndex : gridIndex % this.samples.length;
            } else {
                // If we have 3 or fewer samples, use the original pattern (repeat every 3)
                sampleIndex = Math.floor(gridIndex / 3) % Math.max(1, this.samples.length);
            }
            
            // Update the cell's data-sample attribute
            cell.dataset.sample = sampleIndex;
            
            // Update the title display
            if (titleElement) {
                if (this.samples[sampleIndex]) {
                    titleElement.textContent = this.samples[sampleIndex].name;
                } else {
                    titleElement.textContent = `Sample ${sampleIndex + 1}`;
                }
            }
        });
    }

    switchMode(mode) {
        this.currentMode = mode;
        
        // Update button states
        this.recordModeBtn.classList.toggle('active', mode === 'RECORD');
        this.performModeBtn.classList.toggle('active', mode === 'PERFORM');
        
        // Update mode sections
        this.recordMode.classList.toggle('active', mode === 'RECORD');
        this.performMode.classList.toggle('active', mode === 'PERFORM');
        
        // Stop any ongoing recording when switching modes
        if (this.recordingState === 'recording') {
            this.stopRecording();
        }

        // Reset recording state machine
        this.recordingState = 'idle';
        this.isRecordingOnCooldown = false;
        this.recordingReady = true; // Allow immediate recording when entering RECORD mode
        
        // Clear all active effects and samples when switching modes
        this.clearAllActiveEffectsAndSamples();
        
        // Reset record button state when switching modes
        if (mode === 'RECORD') {
            this.recordBtn.textContent = 'Press to record';
            this.recordBtn.classList.remove('recording');
            this.recordBtn.style.background = '#2a2a2a';
            this.recordBtn.style.borderColor = '#444';
            this.recordBtn.style.color = '#e0e0e0';
        }
        
        // Handle volume monitoring based on mode
        if (mode === 'RECORD') {
            if (this.microphoneSelect.value) {
                this.onMicrophoneChange();
            }
        } else {
            this.stopVolumeMonitoring();
        }
        
        // Reset pressure state and timers when switching modes
        this.lastPressureState = false;
        this.lastRecordingActionTime = 0;
        
        this.debug(`Switched to ${mode} mode`);
    }

    clearAllActiveEffectsAndSamples() {
        // Clear all active sample+effect combinations by stopping their sources
        this.activeSampleSources.forEach((_source, gridIndex) => {
            this.audioEngine.stopLoopedSampleWithEffect(gridIndex);
        });
        this.activeSampleSources.clear();
        
        // Reset all grid cell states
        this.gridCellPressureState.fill(false);
        
        // Clear all debounce timers
        if (this.gridCellDebounceTimers) { // Defensive check before using
            this.gridCellDebounceTimers.forEach(timer => {
                if (timer) clearTimeout(timer);
            });
            this.gridCellDebounceTimers.fill(null);
        }
        
        // Clear all visual feedback
        const cells = this.performGrid.querySelectorAll('.grid-cell');
        cells.forEach(cell => {
            cell.classList.remove('active');
            const statusElement = cell.querySelector('.cell-status');
            if (statusElement) {
                statusElement.textContent = '';
                statusElement.style.color = '#a0a0a0';
            }
        });
        
        this.debug('Cleared all active sample+effect combinations');
    }

    async connectArduino() {
        try {
            await this.serialHandler.connect();
            this.debug('Arduino connected successfully');
        } catch (error) {
            this.debug('Failed to connect to Arduino:', error);
            alert('Failed to connect to Arduino. Please check connection and try again.');
        }
    }

    handleConnectionChange(connected) {
        this.statusText.textContent = connected ? 'Connected' : 'Disconnected';
        this.statusText.style.color = connected ? '#4CAF50' : '#f44336';
        this.connectBtn.textContent = connected ? 'Disconnect' : 'Connect Arduino';
        this.connectBtn.style.background = connected ? '#f44336' : '#4CAF50';
    }

    handleSerialData(pressureMatrix) {
        // Enhanced debugging for pressure data
        const totalPressure = pressureMatrix.reduce((sum, val) => sum + val, 0);
        const avgPressure = totalPressure / 100;
        const maxPressure = Math.max(...pressureMatrix);
        const nonZeroCount = pressureMatrix.filter(p => p > 0).length;
        
        // Update data status to show we're receiving data
        const dataStatus = document.getElementById('dataStatus');
        if (dataStatus) {
            dataStatus.textContent = `Active Sensors: ${nonZeroCount}`;
            dataStatus.style.color = nonZeroCount > 0 ? '#4CAF50' : '#ff6b6b';
        }
        
        // Update connection status visual indicator
        const connectionStatus = document.getElementById('connectionStatus');
        if (connectionStatus) {
            connectionStatus.classList.toggle('data-flowing', nonZeroCount > 0);
        }
        
        // Calculate overall pressure and center of mass for display
        let weightedX = 0, weightedY = 0, totalWeight = 0;
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                const pressure = pressureMatrix[y * 10 + x];
                if (pressure > 0) {
                    weightedX += x * pressure;
                    weightedY += y * pressure;
                    totalWeight += pressure;
                }
            }
        }
        
        const centerX = totalWeight > 0 ? Math.round((weightedX / totalWeight) * 25.5) : 0;
        const centerY = totalWeight > 0 ? Math.round((weightedY / totalWeight) * 25.5) : 0;
        
        // Update display
        this.pressureValue.textContent = Math.round(avgPressure);
        this.xValue.textContent = centerX;
        this.yValue.textContent = centerY;
        
        // Add visual warning if no pressure detected
        if (totalPressure === 0) {
            this.pressureValue.style.color = '#ff6b6b';
            this.xValue.style.color = '#ff6b6b';
            this.yValue.style.color = '#ff6b6b';
        } else {
            this.pressureValue.style.color = '#4CAF50';
            this.xValue.style.color = '#e0e0e0';
            this.yValue.style.color = '#e0e0e0';
        }
        
        // Handle recording in RECORD mode
        if (this.currentMode === 'RECORD') {
            this.handleRecordingPressure(totalPressure);
        }
        
        // Handle grid triggering for PERFORM mode
        if (this.currentMode === 'PERFORM') {
            this.checkGridCellsForPressure(pressureMatrix);
        }
    }

    handleRecordingPressure(totalPressure) {
        const isPressed = totalPressure > this.pressureThreshold;

        // Debug output to help diagnose mat recording issues
        if (Math.abs(totalPressure - this.lastTotalPressure) > 10) {
            this.debug(`Mat pressure: ${totalPressure}, threshold: ${this.pressureThreshold}, isPressed: ${isPressed}, lastState: ${this.lastPressureState}, recordingState: ${this.recordingState}, ready: ${this.recordingReady}`);
            this.lastTotalPressure = totalPressure;
        }

        // Wait for mat to be unpressed before we're ready to detect presses
        if (!this.recordingReady && !isPressed) {
            this.recordingReady = true;
            this.debug('Recording ready - mat is unpressed, waiting for press...');
        }

        // Visual feedback for potential press (only if ready)
        if (isPressed && this.recordingState === 'idle' && !this.isRecordingOnCooldown && this.recordingReady) {
            this.recordBtn.style.background = '#444';
            this.recordBtn.style.color = '#ffa500';
        } else if (!isPressed && this.recordingState === 'idle' && !this.isRecordingOnCooldown) {
            this.recordBtn.style.background = '#2a2a2a';
            this.recordBtn.style.color = '#e0e0e0';
        }

        // Detect rising edge (pressure going from below to above threshold) to toggle recording
        // Only trigger if we're ready (have seen an unpressed state)
        if (isPressed && !this.lastPressureState && this.recordingReady) {
            // This is a rising edge - toggle recording state
            if (this.recordingState === 'idle' && !this.isRecordingOnCooldown) {
                this.debug('🎤 Mat press detected, starting recording...');
                this.startRecording();
            } else if (this.recordingState === 'recording') {
                this.debug('🛑 Mat press detected, stopping recording...');
                this.stopRecording();
            }
        }

        // Update last pressure state
        this.lastPressureState = isPressed;
    }

    async handleManualRecordToggle() {
        if (this.isRecordingOnCooldown) {
            this.debug('Manual record blocked by cooldown.');
            return;
        }
        if (this.recordingState === 'idle') {
            await this.startRecording();
        } else if (this.recordingState === 'recording') {
            await this.stopRecording();
        }
    }

    checkGridCellsForPressure(pressureMatrix) {
        // Define the 3x3 grid regions on the 10x10 sensor
        const gridRegions = [
            // Grid cell 0 (top-left): sensor x=0-2, y=0-2
            { minX: 0, maxX: 2, minY: 0, maxY: 2 },
            // Grid cell 1 (top-center): sensor x=3-5, y=0-2
            { minX: 3, maxX: 5, minY: 0, maxY: 2 },
            // Grid cell 2 (top-right): sensor x=6-9, y=0-2
            { minX: 6, maxX: 9, minY: 0, maxY: 2 },
            // Grid cell 3 (middle-left): sensor x=0-2, y=3-5
            { minX: 0, maxX: 2, minY: 3, maxY: 5 },
            // Grid cell 4 (middle-center): sensor x=3-5, y=3-5
            { minX: 3, maxX: 5, minY: 3, maxY: 5 },
            // Grid cell 5 (middle-right): sensor x=6-9, y=3-5
            { minX: 6, maxX: 9, minY: 3, maxY: 5 },
            // Grid cell 6 (bottom-left): sensor x=0-2, y=6-9
            { minX: 0, maxX: 2, minY: 6, maxY: 9 },
            // Grid cell 7 (bottom-center): sensor x=3-5, y=6-9
            { minX: 3, maxX: 5, minY: 6, maxY: 9 },
            // Grid cell 8 (bottom-right): sensor x=6-9, y=6-9
            { minX: 6, maxX: 9, minY: 6, maxY: 9 }
        ];
        
        // Check each grid region for pressure above threshold
        gridRegions.forEach((region, gridIndex) => {
            let maxPressureInRegion = 0;
            
            // Check all sensor cells in this grid region
            for (let y = region.minY; y <= region.maxY; y++) {
                for (let x = region.minX; x <= region.maxX; x++) {
                    const pressure = pressureMatrix[y * 10 + x];
                    maxPressureInRegion = Math.max(maxPressureInRegion, pressure);
                }
            }
            
            const isPressed = maxPressureInRegion > this.pressureThreshold;
            const wasPressed = this.gridCellPressureState[gridIndex];

            // Debounce logic
            if (this.gridCellDebounceTimers[gridIndex]) {
                clearTimeout(this.gridCellDebounceTimers[gridIndex]);
            }

            this.gridCellDebounceTimers[gridIndex] = setTimeout(() => {
                const currentIsPressed = this.gridCellPressureState[gridIndex];
                if (isPressed && !currentIsPressed) {
                    // Rising edge: pressure just went ON
                    this.gridCellPressureState[gridIndex] = true;
                    this.handleGridCellPressureChange(gridIndex, true, maxPressureInRegion);
                    this.debug(`Grid ${gridIndex}: ON (pressure: ${maxPressureInRegion})`);
                } else if (!isPressed && currentIsPressed) {
                    // Falling edge: pressure just went OFF
                    this.gridCellPressureState[gridIndex] = false;
                    this.handleGridCellPressureChange(gridIndex, false, maxPressureInRegion);
                    this.debug(`Grid ${gridIndex}: OFF (pressure: ${maxPressureInRegion})`);
                }
            }, this.pressureDebounceMs);
        });
    }

    handleGridCellPressureChange(gridIndex, isPressed, pressure) {
        const cell = this.performGrid.children[gridIndex];
        if (!cell) return;
        
        const sampleIndex = parseInt(cell.dataset.sample);
        const effectName = cell.dataset.effect;
        
        if (isPressed) {
            this.debug(`Grid cell ${gridIndex} ACTIVATED: pressure=${pressure}, sample=${sampleIndex}, effect=${effectName}`);
            
            if (this.currentMode === 'PERFORM') {
                this.startSampleWithEffect(gridIndex, sampleIndex, effectName);
            }
        } else {
            this.debug(`Grid cell ${gridIndex} DEACTIVATED`);
            
            if (this.currentMode === 'PERFORM') {
                this.stopSampleWithEffect(gridIndex);
            }
        }
        this.updateGridCellVisual(gridIndex, isPressed, pressure);
    }

    async startSampleWithEffect(gridIndex, sampleIndex, effectName) {
        // Check if we have the sample available
        if (!this.samples[sampleIndex] || !this.samples[sampleIndex].blob) {
            this.debug(`No sample available at index ${sampleIndex} for grid ${gridIndex}`);
            this.updateGridCellVisual(gridIndex, true, 0, true); // Show error
            return;
        }
        
        // Prevent re-triggering if a sample is already playing for this cell
        if (this.activeSampleSources.has(gridIndex)) {
            this.debug(`Grid cell ${gridIndex} is already playing a sample.`);
            return;
        }
        
        try {
            const sample = this.samples[sampleIndex];
            
            // Use the new looped sample method from the audio engine
            const success = await this.audioEngine.startLoopedSampleWithEffect(
                gridIndex,
                sample.blob,
                this.effectsEnabled ? effectName : null, // Pass null to disable effects
                1.0 // volume
            );

            if (success) {
                this.activeSampleSources.set(gridIndex, { sampleIndex, effectName });
                this.updateGridCellVisual(gridIndex, true, 0);
                this.debug(`Started looped sample ${sample.name} with ${this.effectsEnabled ? 'effect ' + effectName : 'no effects'} on grid ${gridIndex}`);
            } else {
                throw new Error("Audio engine failed to start looped sample.");
            }

        } catch (error) {
            this.debug(`Failed to start sample with effect for grid ${gridIndex}:`, error);
            this.updateGridCellVisual(gridIndex, true, 0, true); // Show error
            this.audioEngine.stopLoopedSampleWithEffect(gridIndex); // Ensure cleanup
        }
    }

    stopSampleWithEffect(gridIndex) {
        if (this.activeSampleSources.has(gridIndex)) {
             this.audioEngine.stopLoopedSampleWithEffect(gridIndex);
             this.activeSampleSources.delete(gridIndex);
        }
        this.debug(`Cleaned up tracking for grid ${gridIndex}`);
    }

    updateGridCellVisual(gridIndex, isActive, pressure, isError = false) {
        const cell = this.performGrid.children[gridIndex];
        if (!cell) return;
        
        if (isActive) {
            cell.classList.add('active');
            const statusElement = cell.querySelector('.cell-status');

            if (statusElement) {
                if (isError) {
                    statusElement.textContent = 'NO SAMPLE';
                    statusElement.style.color = '#f44336';
                } else {
                    statusElement.textContent = `PLAYING`;
                    statusElement.style.color = '#4CAF50';
                }
            }
        } else {
            cell.classList.remove('active');
            const statusElement = cell.querySelector('.cell-status');
            if (statusElement) {
                statusElement.textContent = '';
                statusElement.style.color = '#a0a0a0';
            }
        }
    }

    async startRecording() {
        if (this.recordingState !== 'idle' || this.isRecordingOnCooldown) return;

        try {
            const deviceId = this.microphoneSelect.value;
            if (!deviceId) {
                this.debug('❌ No microphone selected');
                alert('Please select a microphone first');
                return;
            }

            // Change state immediately
            this.recordingState = 'recording';
            this.lastRecordingActionTime = Date.now();
            
            // Ensure audio context is running
            if (this.audioEngine.audioContext.state === 'suspended') {
                await this.audioEngine.audioContext.resume();
                this.debug('🎵 Audio context resumed');
            }
            
            this.debug('🎤 Starting recording with device:', deviceId);
            await this.audioEngine.startRecording(deviceId);
            
            this.recordBtn.textContent = '🔴 Recording... (press to stop)';
            this.recordBtn.classList.add('recording');
            this.recordBtn.style.background = '#404040';
            this.recordBtn.style.borderColor = '#666';
            this.recordBtn.style.color = '#ff6b6b';
            
            this.debug('✅ Recording started successfully');
        } catch (error) {
            this.debug('❌ Failed to start recording:', error);
            this.recordingState = 'idle'; // Revert state on failure
            this.recordBtn.textContent = 'Recording failed - try again';
            this.recordBtn.classList.remove('recording');
            this.recordBtn.style.background = '#3a2a2a';
            this.recordBtn.style.borderColor = '#555';
            this.recordBtn.style.color = '#ff6b6b';
            
            // Reset button after 3 seconds
            setTimeout(() => {
                if (this.recordingState !== 'recording') { // Don't reset if another recording started
                    this.recordBtn.textContent = 'Press to record';
                    this.recordBtn.style.background = '#2a2a2a';
                    this.recordBtn.style.borderColor = '#444';
                    this.recordBtn.style.color = '#e0e0e0';
                }
            }, 3000);
            
            alert('Failed to start recording. Please check microphone permissions.');
        }
    }

    async stopRecording() {
        if (this.recordingState !== 'recording') {
            this.debug('⚠️ Stop recording called but not currently recording');
            return;
        }

        // Set state to idle and start cooldown to prevent re-triggers
        this.recordingState = 'idle';
        this.isRecordingOnCooldown = true;
        this.recordingReady = false; // Reset ready state to require unpressed before next recording
        
        try {
            this.debug('⏹️ Stopping recording...');
            
            // Update button state immediately to show we're processing
            this.recordBtn.textContent = 'Processing recording...';
            this.recordBtn.classList.remove('recording');
            this.recordBtn.style.background = '#2a2a2a';
            this.recordBtn.style.borderColor = '#444';
            this.recordBtn.style.color = '#ffa500';
            
            const audioBlob = await this.audioEngine.stopRecording();
            
            // Enhanced debugging for audioBlob
            this.debug(`📦 AudioBlob received: ${audioBlob ? 'YES' : 'NO'}`);
            this.debug(`📦 AudioBlob size: ${audioBlob ? audioBlob.size : 'N/A'} bytes`);
            this.debug(`📦 AudioBlob type: ${audioBlob ? audioBlob.type : 'N/A'}`);
            
            if (audioBlob && audioBlob.size > 100) { // Check for minimal size
                this.debug('🔍 Audio blob is valid, checking duration...');
                
                // Get actual audio duration
                const audioDuration = await this.getAudioDuration(audioBlob);
                this.debug(`⏱️ Audio duration calculated: ${audioDuration} seconds`);
                
                // Only save if we have meaningful audio (more than 0.1 seconds)
                if (audioDuration > 0.1) {
                    this.debug('✅ Duration is valid, creating sample...');
                    
                    const sample = {
                        id: Date.now(),
                        name: `Sample ${this.samples.length + 1}`,
                        blob: audioBlob,
                        duration: this.formatDuration(audioDuration),
                        timestamp: new Date().toLocaleTimeString()
                    };
                    
                    this.samples.push(sample);
                    this.debug(`📋 Sample added to array. Total samples: ${this.samples.length}`);
                    
                    this.saveSamples();
                    this.debug('💾 Sample stored in memory (no persistent storage for blobs)');
                    
                    this.updateSamplesList();
                    this.debug('🔄 Sample list updated');
                    
                    this.debug(`✅ Recording stopped successfully, sample saved with duration: ${this.formatDuration(audioDuration)}`);
                    
                    // Show success feedback
                    this.recordBtn.textContent = `✅ Sample saved! (${this.formatDuration(audioDuration)})`;
                    this.recordBtn.style.color = '#4CAF50';
                    
                } else {
                    this.debug(`⚠️ Recording too short (${audioDuration}s), not saving`);
                    this.recordBtn.textContent = 'Recording too short - try again';
                    this.recordBtn.style.color = '#ff6b6b';
                }
            } else {
                this.debug('⚠️ Recording stopped but no audio data received');
                this.recordBtn.textContent = 'No audio recorded - try again';
                this.recordBtn.style.color = '#ff6b6b';
            }
        } catch (error) {
            this.debug('❌ Failed to stop recording:', error);
            this.recordBtn.textContent = 'Recording error - try again';
            this.recordBtn.classList.remove('recording');
            this.recordBtn.style.background = '#3a2a2a';
            this.recordBtn.style.borderColor = '#555';
            this.recordBtn.style.color = '#ff6b6b';
        } finally {
             // Reset button and cooldown state after the cooldown period
            setTimeout(() => {
                this.isRecordingOnCooldown = false;
                if (this.recordingState === 'idle') { // Only reset text if we are still idle
                    this.recordBtn.textContent = 'Press to record';
                    this.recordBtn.style.background = '#2a2a2a';
                    this.recordBtn.style.borderColor = '#444';
                    this.recordBtn.style.color = '#e0e0e0';
                }
                this.debug('Recording cooldown finished.');
            }, this.recordingCooldownMs);
        }
    }

    async getAudioDuration(audioBlob) {
        this.debug('🕐 Getting audio duration...');
        return new Promise((resolve) => {
            const audio = new Audio();
            audio.addEventListener('loadedmetadata', () => {
                this.debug(`🕐 Audio duration loaded: ${audio.duration} seconds`);
                resolve(audio.duration);
            });
            audio.addEventListener('error', (e) => {
                this.debug(`🕐 Audio duration error: ${e.message}`);
                resolve(0); // Fallback if duration can't be determined
            });
            audio.src = URL.createObjectURL(audioBlob);
        });
    }

    updateSamplesList() {
        if (this.samples.length === 0) {
            this.samplesContainer.innerHTML = '<p class="no-samples">No samples recorded yet</p>';
            return;
        }
        
        this.samplesContainer.innerHTML = this.samples.map(sample => {
            const hasBlob = sample.blob != null;
            const playButtonClass = hasBlob ? 'play-btn' : 'play-btn disabled';
            const playButtonText = hasBlob ? 'Play' : 'No Audio';
            
            return `
                <div class="sample-item" data-id="${sample.id}">
                    <div class="sample-info">
                        <div class="sample-name">${sample.name}</div>
                        <div class="sample-duration">${sample.duration} - ${sample.timestamp}</div>
                    </div>
                    <div class="sample-controls">
                        <button class="${playButtonClass}" data-action="play" data-sample-id="${sample.id}" ${hasBlob ? '' : 'disabled'}>${playButtonText}</button>
                        <button class="delete-btn" data-action="delete" data-sample-id="${sample.id}">Delete</button>
                    </div>
                </div>
            `;
        }).join('');
        
        // Update grid cell titles based on available samples
        this.updateGridSampleTitles();
    }

    async playSample(sampleId) {
        const sample = this.samples.find(s => s.id === sampleId);
        if (sample && sample.blob) {
            try {
                await this.audioEngine.playSample(sample.blob);
                this.debug(`Playing sample: ${sample.name}`);
            } catch (error) {
                this.debug(`Failed to play sample ${sample.name}:`, error);
                alert('Failed to play sample. Please check your audio settings.');
            }
        } else {
            this.debug(`Sample ${sampleId} has no audio data`);
            alert('This sample has no audio data. Please record a new sample.');
        }
    }

    deleteSample(sampleId) {
        this.samples = this.samples.filter(s => s.id !== sampleId);
        this.saveSamples();
        this.updateSamplesList();
        this.debug(`Deleted sample: ${sampleId}`);
    }

    clearSamples() {
        if (confirm('Are you sure you want to clear all samples?')) {
            this.samples = [];
            this.saveSamples();
            this.updateSamplesList();
            this.debug('All samples cleared');
        }
    }

    triggerGridCell(index) {
        // This method is kept for manual testing but is superseded by pressure handling
        const cell = this.performGrid.children[index];
        if (!cell) return;
        
        // Visual feedback
        cell.classList.add('active');
        setTimeout(() => {
            cell.classList.remove('active')
            this.updateGridCellVisual(index, false, 0);
        }, 300);
        
        this.handleGridCellPressureChange(index, true, 100);
        setTimeout(() => this.handleGridCellPressureChange(index, false, 0), 1000);
        
        this.debug(`Manually triggered grid cell ${index}`);
    }

    async togglePerformanceRecording() {
        if (this.isPerformanceRecording) {
            this.stopPerformanceRecording();
        } else {
            this.startPerformanceRecording();
        }
    }

    async startPerformanceRecording() {
        try {
            // Ensure audio context is running
            if (this.audioEngine.audioContext.state === 'suspended') {
                await this.audioEngine.audioContext.resume();
            }
            
            // Start recording and store the promise that will resolve with the blob
            this.performanceRecordingPromise = this.audioEngine.startPerformanceRecording();
            this.isPerformanceRecording = true;
            this.performRecordBtn.textContent = 'Stop Performance Recording';
            this.performRecordBtn.classList.add('recording');
            this.downloadBtn.disabled = true;
            this.debug('Performance recording started');
        } catch (error) {
            this.debug('Failed to start performance recording:', error);
            alert('Failed to start performance recording. Please try again.');
        }
    }

    async stopPerformanceRecording() {
        if (!this.isPerformanceRecording) return;
        
        try {
            // Stop the recording
            await this.audioEngine.stopPerformanceRecording();
            
            // Wait for the recording blob to be available
            this.performanceRecordingBlob = await this.performanceRecordingPromise;
            
            this.isPerformanceRecording = false;
            this.performRecordBtn.textContent = 'Start Performance Recording';
            this.performRecordBtn.classList.remove('recording');
            this.downloadBtn.disabled = false;
            
            this.debug('Performance recording stopped and ready for download');
            
            // Show visual feedback that recording is ready
            this.downloadBtn.textContent = 'Download Performance';
            this.downloadBtn.style.background = '#4CAF50';
            this.downloadBtn.style.borderColor = '#4CAF50';
            this.downloadBtn.style.color = '#fff';
            
        } catch (error) {
            this.debug('Failed to stop performance recording:', error);
            alert('Failed to stop performance recording. Please try again.');
            
            // Reset state on error
            this.isPerformanceRecording = false;
            this.performRecordBtn.textContent = 'Start Performance Recording';
            this.performRecordBtn.classList.remove('recording');
        }
    }

    downloadPerformance() {
        if (!this.performanceRecordingBlob) {
            alert('No performance recording available to download.');
            return;
        }
        
        const url = URL.createObjectURL(this.performanceRecordingBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `performance_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        
        // Reset download button styling after download
        this.downloadBtn.textContent = 'Download Performance';
        this.downloadBtn.style.background = '#2a2a2a';
        this.downloadBtn.style.borderColor = '#444';
        this.downloadBtn.style.color = '#e0e0e0';
        this.downloadBtn.disabled = true;
        
        this.debug('Performance downloaded successfully');
    }

    formatDuration(seconds) {
        if (typeof seconds !== 'number' || isNaN(seconds)) {
            return '0:00';
        }
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    debug(message, data = null) {
        console.log(message, data);
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        
        // Add styling for different types of debug messages
        if (message.includes('✓')) {
            logEntry.style.color = '#4CAF50';
        } else if (message.includes('✗') || message.includes('ERROR')) {
            logEntry.style.color = '#f44336';
        } else if (message.includes('⚠') || message.includes('WARN')) {
            logEntry.style.color = '#ff9800';
        } else if (message.includes('🧪') || message.includes('TEST')) {
            logEntry.style.color = '#2196F3';
        } else if (message.includes('🎛️') || message.includes('EFFECT')) {
            logEntry.style.color = '#9c27b0';
        }
        
        logEntry.textContent = `[${timestamp}] ${message}`;
        if (data) {
            logEntry.textContent += ` ${JSON.stringify(data)}`;
        }
        this.debugLog.appendChild(logEntry);
        this.debugLog.scrollTop = this.debugLog.scrollHeight;
        
        // Keep debug log manageable
        while (this.debugLog.children.length > 100) {
            this.debugLog.removeChild(this.debugLog.firstChild);
        }
    }

    testRandomEffect() {
        const effects = Object.keys(this.audioEngine.rnboEffects);
        if (effects.length > 0) {
            const randomEffect = effects[Math.floor(Math.random() * effects.length)];
            this.debug(`🧪 Testing random effect: ${randomEffect}`);
            this.audioEngine.testEffect(randomEffect);
        } else {
            this.debug('🧪 No effects loaded to test.');
        }
    }

    debugEffects() {
        this.debug('🎛️ Forcing all effects ON for 2 seconds for debugging...');
        const effects = Object.keys(this.audioEngine.rnboEffects);
        effects.forEach(effect => this.audioEngine.applyEffect(effect, true));

        setTimeout(() => {
            this.debug('🎛️ Turning all effects OFF.');
            effects.forEach(effect => this.audioEngine.applyEffect(effect, false));
        }, 2000);
    }

    setupEffectsControls() {
        const effectsConfig = {
            pitchshifter: {
                name: 'Pitch Shifter',
                params: [
                    { id: 'delay1', name: 'High Pitch Delay', min: 0.005, max: 0.05, step: 0.001, unit: 's' },
                    { id: 'delay2', name: 'Low Pitch Delay', min: 0.05, max: 0.2, step: 0.001, unit: 's' },
                    { id: 'feedback1', name: 'High Feedback', min: 0, max: 0.8, step: 0.01, unit: '' },
                    { id: 'feedback2', name: 'Low Feedback', min: 0, max: 0.8, step: 0.01, unit: '' },
                    { id: 'output', name: 'Output Level', min: 0, max: 3, step: 0.1, unit: '' }
                ]
            },
            ringmod: {
                name: 'Ring Modulator',
                params: [
                    { id: 'frequency', name: 'Modulator Frequency', min: 1, max: 500, step: 1, unit: 'Hz' },
                    { id: 'depth', name: 'Modulation Depth', min: 0, max: 1, step: 0.01, unit: '' },
                    { id: 'output', name: 'Output Level', min: 0, max: 2, step: 0.1, unit: '' }
                ]
            },
            freezer: {
                name: 'Freezer (Reverb)',
                params: [
                    { id: 'output', name: 'Reverb Level', min: 0, max: 2, step: 0.1, unit: '' }
                ]
            },
            vibrato: {
                name: 'Vibrato',
                params: [
                    { id: 'rate', name: 'Vibrato Rate', min: 0.1, max: 20, step: 0.1, unit: 'Hz' },
                    { id: 'depth', name: 'Vibrato Depth', min: 0, max: 0.02, step: 0.001, unit: 's' },
                    { id: 'output', name: 'Output Level', min: 0, max: 2, step: 0.1, unit: '' }
                ]
            },
            filterdelay: {
                name: 'Filter Delay',
                params: [
                    { id: 'frequency', name: 'Filter Frequency', min: 100, max: 10000, step: 100, unit: 'Hz' },
                    { id: 'delayTime', name: 'Delay Time', min: 0.01, max: 1, step: 0.01, unit: 's' },
                    { id: 'feedback', name: 'Feedback', min: 0, max: 0.8, step: 0.01, unit: '' },
                    { id: 'output', name: 'Output Level', min: 0, max: 2, step: 0.1, unit: '' }
                ]
            },
            octaver: {
                name: 'Octaver',
                params: [
                    { id: 'frequency', name: 'Filter Frequency', min: 200, max: 2000, step: 50, unit: 'Hz' },
                    { id: 'output', name: 'Output Level', min: 0, max: 2, step: 0.1, unit: '' }
                ]
            }
        };

        this.effectsControlContent.innerHTML = '';
        
        Object.entries(effectsConfig).forEach(([effectName, config]) => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'effect-control-group';
            groupDiv.innerHTML = `
                <div class="effect-control-title" data-effect="${effectName}">${config.name}</div>
                ${config.params.map(param => `
                    <div class="parameter-control">
                        <div class="parameter-label">
                            <span>${param.name}</span>
                            <span class="parameter-value" id="${effectName}-${param.id}-value">
                                ${this.audioEngine.getEffectParameter(effectName, param.id)}${param.unit}
                            </span>
                        </div>
                        <input type="range" 
                               class="parameter-slider" 
                               id="${effectName}-${param.id}-slider"
                               min="${param.min}" 
                               max="${param.max}" 
                               step="${param.step}"
                               value="${this.audioEngine.getEffectParameter(effectName, param.id)}"
                               data-effect="${effectName}"
                               data-param="${param.id}"
                               data-unit="${param.unit}">
                    </div>
                `).join('')}
            `;
            this.effectsControlContent.appendChild(groupDiv);
        });

        // Add event listeners for all sliders
        this.effectsControlContent.querySelectorAll('.parameter-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const effect = e.target.dataset.effect;
                const param = e.target.dataset.param;
                const unit = e.target.dataset.unit;
                const value = parseFloat(e.target.value);
                
                // Update the display value
                const valueDisplay = document.getElementById(`${effect}-${param}-value`);
                if (valueDisplay) {
                    valueDisplay.textContent = `${value}${unit}`;
                }
                
                // Update the audio engine parameter
                this.audioEngine.setEffectParameter(effect, param, value);
                
                this.debug(`Updated ${effect} ${param} to ${value}${unit}`);
            });
        });
    }

    updateEffectsControlDisplay() {
        // Update the visual state of effect controls based on active effects
        const effectTitles = this.effectsControlContent.querySelectorAll('.effect-control-title');
        effectTitles.forEach(title => {
            const effectName = title.dataset.effect;
            const isActive = this.audioEngine.isEffectActive(effectName);
            title.classList.toggle('active', isActive);
        });

        // Update slider states
        const sliders = this.effectsControlContent.querySelectorAll('.parameter-slider');
        sliders.forEach(slider => {
            const effectName = slider.dataset.effect;
            const isActive = this.audioEngine.isEffectActive(effectName);
            slider.classList.toggle('active', isActive);
        });
    }

    resetAllEffects() {
        if (confirm('Reset all effect parameters to default values?')) {
            this.audioEngine.resetAllEffectParameters();
            this.setupEffectsControls();
            this.debug('All effect parameters reset to defaults');
        }
    }

    toggleEffects() {
        this.effectsEnabled = !this.effectsEnabled;
        
        // Update button text and style
        this.effectsToggleBtn.textContent = this.effectsEnabled ? 'Effects: ON' : 'Effects: OFF';
        this.effectsToggleBtn.classList.toggle('active', this.effectsEnabled);
        
        // Stop all currently playing samples and restart them with new effects state
        const activeCells = Array.from(this.activeSampleSources.keys());
        activeCells.forEach(gridIndex => {
            const { sampleIndex, effectName } = this.activeSampleSources.get(gridIndex);
            this.stopSampleWithEffect(gridIndex);
            // Small delay to ensure clean restart
            setTimeout(() => {
                this.startSampleWithEffect(gridIndex, sampleIndex, effectName);
            }, 50);
        });
        
        this.debug(`Effects ${this.effectsEnabled ? 'enabled' : 'disabled'}`);
    }

    toggleDebug() {
        this.debugPanel.classList.toggle('active');
        this.debugToggle.textContent = this.debugPanel.classList.contains('active') ? 'Hide Debug' : 'Show Debug';
    }

    toggleEffectsDebug() {
        this.effectsDebugPanel.classList.toggle('active');
        this.effectsDebugToggle.textContent = this.effectsDebugPanel.classList.contains('active') ? 'Hide Effects Debug' : 'Show Effects Debug';
        if (this.effectsDebugPanel.classList.contains('active')) {
            this.refreshEffectsDebugPanel();
        }
    }

    toggleEffectsControl() {
        this.effectsControlPanel.classList.toggle('active');
        this.effectsControlToggle.textContent = this.effectsControlPanel.classList.contains('active') ? 'Hide Controls' : 'Effect Controls';
        if (this.effectsControlPanel.classList.contains('active')) {
            this.updateEffectsControlDisplay();
        }
    }

    refreshEffectsDebugPanel() {
        this.effectsDebugContent.innerHTML = '';
        const status = this.audioEngine.getEffectStatus();
        
        const content = Object.entries(status).map(([effectName, effectStatus]) => {
            const paramsHtml = effectStatus.parameters
                .filter(p => p.type === 'ParameterTypeNumber' && !p.isSignal)
                .map(p => `
                    <div class="parameter-item">
                        <span class="parameter-name">${p.id}</span>
                        <span class="parameter-value">${Number(p.value).toFixed(2)}</span>
                    </div>
                `).join('');

            return `
                <div class="effect-debug-item">
                    <div class="effect-debug-title">${effectName}</div>
                    <div class="effect-debug-row">
                        <span class="effect-debug-label">Active:</span>
                        <span class="effect-debug-value ${effectStatus.active ? 'success' : 'error'}">${effectStatus.active ? 'ON' : 'OFF'}</span>
                    </div>
                     <div class="effect-debug-row">
                        <span class="effect-debug-label">Loaded:</span>
                        <span class="effect-debug-value ${effectStatus.hasDevice ? 'success' : 'error'}">${effectStatus.hasDevice ? 'Yes' : 'No'}</span>
                    </div>
                    <div class="effect-parameters">
                        <div class="effect-parameters-title">Parameters:</div>
                        ${paramsHtml}
                    </div>
                </div>
            `;
        }).join('');
        
        this.effectsDebugContent.innerHTML = content;
        this.updateEffectsControlDisplay();
    }
}

// Initialize the app
const app = new AudioRugApp();
window.app = app; // Make available globally for HTML onclick handlers