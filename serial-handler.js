export class SerialHandler {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isConnected = false;
        this.onDataReceived = null;
        this.onConnectionChange = null;
        this.readBuffer = '';
        this.keepReading = false;
    }

    async connect() {
        try {
            // Check if Web Serial API is supported
            if (!('serial' in navigator)) {
                throw new Error('Web Serial API is not supported in this browser');
            }

            // Request a port
            this.port = await navigator.serial.requestPort();
            
            // Open the port
            await this.port.open({
                baudRate: 9600,
                dataBits: 8,
                stopBits: 1,
                parity: 'none'
            });

            this.isConnected = true;
            this.keepReading = true;
            
            // Start reading
            this.startReading();
            
            if (this.onConnectionChange) {
                this.onConnectionChange(true);
            }
            
            console.log('Connected to Arduino');
        } catch (error) {
            console.error('Failed to connect to Arduino:', error);
            throw error;
        }
    }

    async disconnect() {
        if (!this.port) return;

        this.keepReading = false;

        if (this.reader) {
            try {
                await this.reader.cancel();
            } catch (error) {
                console.warn('Error cancelling reader on disconnect:', error.message);
            }
        }
        
        if (this.port.writable) {
            try {
                const writer = this.port.writable.getWriter();
                writer.releaseLock();
            } catch (error) {
                 console.warn('Error releasing writer on disconnect:', error.message);
            }
        }

        try {
            await this.port.close();
        } catch (error) {
            console.error('Error closing port on disconnect:', error.message);
        }

        this.port = null;
        this.handleDisconnection();
        console.log('Disconnected from Arduino');
    }

    handleDisconnection() {
        if (!this.isConnected) return;

        console.warn('Device connection lost or closed.');
        this.isConnected = false;
        this.keepReading = false;
        this.port = null;
        this.reader = null;

        if (this.onConnectionChange) {
            this.onConnectionChange(false);
        }
    }

    async startReading() {
        const textDecoder = new TextDecoderStream();
        const readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
        readableStreamClosed.catch(error => {
            if (error.name === 'NetworkError') {
                console.error('Device lost:', error);
                this.handleDisconnection();
            } else {
                console.error('Read pipe error:', error);
            }
        });

        this.reader = textDecoder.readable.getReader();

        try {
            while (this.port && this.port.readable && this.keepReading) {
                const { value, done } = await this.reader.read();
                if (done) {
                    break;
                }
                this.processIncomingData(value);
            }
        } catch (error) {
            console.error('Error in serial read loop:', error);
            if (error.name === 'NetworkError') {
                this.handleDisconnection();
            }
        } finally {
            if (this.reader) {
                this.reader.releaseLock();
                this.reader = null;
            }
        }
    }

    processIncomingData(data) {
        // Add new data to buffer
        this.readBuffer += data;
        
        // Process complete lines
        let lines = this.readBuffer.split('\n');
        this.readBuffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        lines.forEach(line => {
            line = line.trim();
            if (line) {
                this.parseSerialData(line);
            }
        });
    }

    parseSerialData(line) {
        try {
            // Log raw incoming line for debugging
            console.log('Raw serial line:', line, 'Length:', line.length);
            
            // Expected format: 100 comma-separated values (10x10 pressure matrix)
            const values = line.split(',');
            
            console.log('Split values count:', values.length);
            
            if (values.length === 100) {
                const pressureMatrix = values.map((val, index) => {
                    const trimmed = val.trim();
                    const pressure = parseInt(trimmed) || 0;
                    const clamped = Math.max(0, Math.min(255, pressure));
                    
                    // Log first few values for debugging
                    if (index < 5) {
                        console.log(`Value ${index}: "${trimmed}" -> ${pressure} -> ${clamped}`);
                    }
                    
                    return clamped;
                });
                
                // Calculate and log statistics
                const totalPressure = pressureMatrix.reduce((sum, val) => sum + val, 0);
                const maxPressure = Math.max(...pressureMatrix);
                const minPressure = Math.min(...pressureMatrix);
                const nonZeroCount = pressureMatrix.filter(p => p > 0).length;
                
                console.log(`Pressure stats: Total=${totalPressure}, Max=${maxPressure}, Min=${minPressure}, NonZero=${nonZeroCount}`);
                
                if (this.onDataReceived) {
                    this.onDataReceived(pressureMatrix);
                }
            } else {
                // More detailed logging for malformed lines
                console.warn(`Malformed line: expected 100 values, got ${values.length}`);
                console.warn('First 10 values:', values.slice(0, 10));
                console.warn('Line preview:', line.substring(0, 100) + (line.length > 100 ? '...' : ''));
            }
        } catch (error) {
            console.error('Error parsing serial data:', error);
            console.error('Problematic line:', line);
        }
    }

    async sendData(data) {
        try {
            if (!this.port || !this.isConnected) {
                throw new Error('Not connected to Arduino');
            }
            
            if (!this.writer) {
                this.writer = this.port.writable.getWriter();
            }
            
            const encoder = new TextEncoder();
            await this.writer.write(encoder.encode(data + '\n'));
            
            console.log('Data sent to Arduino:', data);
        } catch (error) {
            console.error('Error sending data:', error);
        }
    }
}