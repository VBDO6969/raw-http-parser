const net = require('net')
const imported = require('./generated-parser.js')

const ALLOWED_TARGET_BYTES = new Uint8Array(256);
for (let i = 0x41; i <= 0x5A; i++) ALLOWED_TARGET_BYTES[i] = 1; // A-Z
for (let i = 0x61; i <= 0x7A; i++) ALLOWED_TARGET_BYTES[i] = 1; // a-z
for (let i = 0x30; i <= 0x39; i++) ALLOWED_TARGET_BYTES[i] = 1; // 0-9
const extraTargetChars = [0x2D, 0x2E, 0x5F, 0x7E, 0x21, 0x24, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2F, 0x3A, 0x3B, 0x3D, 0x3F, 0x40, 0x25];
for (const char of extraTargetChars) {
    ALLOWED_TARGET_BYTES[char] = 1;
}
const ALLOWED_FIELD_KEY_BYTES = new Uint8Array(256);
for (let i = 0x41; i <= 0x5A; i++) ALLOWED_FIELD_KEY_BYTES[i] = 1; // A-Z
for (let i = 0x61; i <= 0x7A; i++) ALLOWED_FIELD_KEY_BYTES[i] = 1; // a-z
for (let i = 0x30; i <= 0x39; i++) ALLOWED_FIELD_KEY_BYTES[i] = 1; // 0-9
const extraFieldKeyChars = [0x21, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2A, 0x2B, 0x2D, 0x2E, 0x5E, 0x5F, 0x60, 0x7C, 0x7E];
for (const char of extraFieldKeyChars) {
    ALLOWED_FIELD_KEY_BYTES[char] = 1;
}
const ALLOWED_FIELD_VALUE_BYTES_AND_SKIPPING_SP_AND_OWS = new Uint8Array(256);
for (let i = 0x21; i <= 0x7E; i++) ALLOWED_FIELD_VALUE_BYTES_AND_SKIPPING_SP_AND_OWS[i] = 1;
for (let i = 0x80; i <= 0xFF; i++) ALLOWED_FIELD_VALUE_BYTES_AND_SKIPPING_SP_AND_OWS[i] = 1;
ALLOWED_FIELD_VALUE_BYTES_AND_SKIPPING_SP_AND_OWS[0x20] = 2; 
ALLOWED_FIELD_VALUE_BYTES_AND_SKIPPING_SP_AND_OWS[0x09] = 2;

const server = net.createServer((socket) => {
        console.log('new client is connected!!')
        let req = {headers : {}}
        let chunksArr = []
        let payloadArr = []
        let header
        let totalBytes = 0
        const MAX_HEADER_BYTES = 8192
        const MAX_BODY_BYTES = 10485760 // 10MB as max payload size
        let state = 0
        let isHeaderFound = false
        let absoluteLastCRLFCRLFByte = 0
        let expectedPayloadLength = 0
        let unknownEntity // the piece of chunk that we do not know either it payload or a beginning of a new request header
        
        socket.on('data', (chunk) => {
                chunksArr.push(chunk)
                totalBytes += chunk.length
                
                // Searching for the end of the header by detecting "\r\n\r\n"
                if (!isHeaderFound){
                    for(let pointer = 0 ; pointer < chunk.length ; pointer++){
                        if (chunk[pointer] === 0x0A) { if (state === 1){state++} else if (state === 3) {state++;} else {state = 0} } // \n searching
                        else if (chunk[pointer] === 0x0D) { if (state === 0 || state === 2){state++} else {state = 1} } // \r searching
                        else { state = 0 }

                        if ( state === 4 ) {
                            absoluteLastCRLFCRLFByte = pointer + (totalBytes - chunk.length); 
                            if (absoluteLastCRLFCRLFByte > MAX_HEADER_BYTES) {
                                socket.destroy();
                                return;
                            }
                            unknownEntity = chunk.subarray(pointer + 1); 
                            header = Buffer.concat(chunksArr); 
                            isHeaderFound = true; 
                            break; 
                        }
                    }
                    
                    if (!isHeaderFound) {
                        if (totalBytes > MAX_HEADER_BYTES) {
                            socket.destroy();
                        }
                        return; // Wait for the next chunk, do NOT go to Payload Assembling
                    }
                }

                if (header !== undefined) {
                    req = { headers: {} }
                    req = imported.parseMethod(header , socket , req) // method extracting and validating
                    if(socket.destroyed) return

                    if(header[req.pointer] === 0x2f){ // slash checking
                        let startPointerOfRequestTarget = req.pointer // first pointer headed to slash
                        req.pointer++

                        while(header[req.pointer] !== 0x20){
                            if(ALLOWED_TARGET_BYTES[header[req.pointer]] === 1){
                                req.pointer++
                            } else {
                                socket.destroy();
                                return;
                            }
                            
                        } // loop of checking the validity of Request Target
                        req.requestTarget = header.toString("ASCII" , startPointerOfRequestTarget , req.pointer)
                        req.pointer++ // this makes pointer headed to first byte of HTTP Version (req.pointer points to "H" exactly)
                    } else {
                        socket.destroy();
                        return;
                    }

                    imported.parseVersion(header , socket , req) // check the validity of HTTP/1.0 or HTTP/1.1
                    if(socket.destroyed) return

                    while (req.pointer < absoluteLastCRLFCRLFByte - 1) {
                        let currentKey
                        let startPointerOfFieldKey = req.pointer
                        while (ALLOWED_FIELD_KEY_BYTES[header[req.pointer]] === 1){
                            req.pointer++
                        } // this while loop and the if statement below check the validity of the grammer of the field-key and the colon 
                        if (header[req.pointer] === 0x3A) { // checking the existance of ":" to store the key temporarily
                            currentKey = header.toString('ASCII' , startPointerOfFieldKey , req.pointer).toLowerCase();
                            req.pointer++; // here , we're standing on the first byte after the colon
                        } else {
                            socket.destroy();
                            return;
                        }

                        while (ALLOWED_FIELD_VALUE_BYTES_AND_SKIPPING_SP_AND_OWS[header[req.pointer]] === 2) {
                            req.pointer++;
                        } // skipping the SPs and OWSs

                        let startPointerOfRealFieldValue = req.pointer // the pointer of the first real valid value (the valid value except SPs and OWSs)
                        let endPointerOfRealFieldValue = startPointerOfRealFieldValue

                        while (ALLOWED_FIELD_VALUE_BYTES_AND_SKIPPING_SP_AND_OWS[header[req.pointer]] !== 0) { // loop of eliminating the invalid chars
                            while (ALLOWED_FIELD_VALUE_BYTES_AND_SKIPPING_SP_AND_OWS[header[req.pointer]] === 1) { // loop of skipping the real valid chars (valid chars except SPs and OWSs) , and when the loop ends , it assign the endPointerOfRealFieldValue to the last observed real valid char before the SP or OWS
                                req.pointer++
                            }
                            endPointerOfRealFieldValue = req.pointer // Assigning to store the last potential real valid char
                            while (ALLOWED_FIELD_VALUE_BYTES_AND_SKIPPING_SP_AND_OWS[header[req.pointer]] === 2) { // loop of skipping SPs and OWSs and do nothing but incrementing the pointer
                                req.pointer++
                            }
                        }
                        if (header[req.pointer] === 0x0D && header[req.pointer + 1] === 0x0A) {
                            if (Object.hasOwn(req.headers, currentKey)) {
                                socket.destroy()
                                return;
                            }
                            req.headers[currentKey] = header.toString('utf8' , startPointerOfRealFieldValue , endPointerOfRealFieldValue)
                            req.pointer += 2
                        } else {
                            socket.destroy()
                            return;
                        }
                    }
                    if (req.version === 'HTTP/1.1' && !Object.hasOwn(req.headers , 'host')) {
                        socket.destroy();
                        return;
                    }
                    if (Object.hasOwn(req.headers, 'transfer-encoding')) {
                        if (Object.hasOwn(req.headers, 'content-length')){
                            socket.destroy()
                            return;
                        } else if (req.version === 'HTTP/1.0'){
                            socket.destroy()
                            return;
                        } else {
                            if (req.headers['transfer-encoding'] === 'chunked') {
                                // logic of "transfer-encoding: chunked"
                            } else {
                                console.log('later')
                            }
                        }
                    } else if (Object.hasOwn(req.headers, 'content-length')) {
                        if (/^\d+$/.test(req.headers['content-length'])){
                            expectedPayloadLength = parseInt(req.headers['content-length'])
                            
                            if (expectedPayloadLength > MAX_BODY_BYTES) {
                                socket.destroy()
                                return;
                            }

                            if (expectedPayloadLength === 0) { // logic of "content-length: non-negative integer"
                                socket.write("HTTP/1.1 204 No Content\r\n\r\n")
                                chunksArr = unknownEntity.length > 0 ? [unknownEntity] : []
                                totalBytes = chunksArr.length > 0 ? chunksArr[0].length : 0
                                state = 0
                                header = undefined
                                isHeaderFound = false
                                absoluteLastCRLFCRLFByte = 0
                                expectedPayloadLength = 0
                                payloadArr = []
                            } else if (expectedPayloadLength > 0) {
                                
                                header = undefined // point of changing control flow to the "payload assembling" state
                                if (expectedPayloadLength >= unknownEntity.length) {
                                    payloadArr.push(unknownEntity)
                                    expectedPayloadLength -= unknownEntity.length
                                    
                                    if (expectedPayloadLength === 0) {
                                        req.payload = Buffer.concat(payloadArr)
                                        chunksArr = []
                                        totalBytes = 0
                                        state = 0
                                        isHeaderFound = false
                                        absoluteLastCRLFCRLFByte = 0
                                        payloadArr = []
                                    }
                                } else {
                                    payloadArr.push(unknownEntity.subarray(0, expectedPayloadLength))
                                    chunksArr = [unknownEntity.subarray(expectedPayloadLength)]
                                    req.payload = Buffer.concat(payloadArr) 
                                    totalBytes = chunksArr[0].length
                                    state = 0
                                    isHeaderFound = false
                                    expectedPayloadLength = 0
                                    absoluteLastCRLFCRLFByte = 0
                                    payloadArr = []
                                }
                            } else {
                                socket.destroy()
                                return;
                            }
                        } else {
                            socket.destroy()
                            return;
                        }
                    } else {
                        state = 0;
                        header = undefined;
                        isHeaderFound = false;
                        absoluteLastCRLFCRLFByte = 0;
                        chunksArr = unknownEntity && unknownEntity.length > 0 ? [unknownEntity] : [];
                        totalBytes = chunksArr.length > 0 ? chunksArr[0].length : 0;
                        payloadArr = [];
                        expectedPayloadLength = 0
                    }
                    
                } else {
                    // logic of Payload Assembling , need to understand that TCP Protocol is a "blind" protocol that does not see the boundries of HTTP Requests , so that we shall find that the first byte of the later request (first byte of the method) will be directly after the last byte of the payload , and since the presence of Fragmentation , this Adhesion will be in the same TCP Segment , so we need a counter that "jumps" across the chunk objects that exist in the "chunksArr" array
                    if (req.headers['content-length'] > 0) {
                        if (expectedPayloadLength >= chunk.length){
                            payloadArr.push(chunk)
                            expectedPayloadLength -= chunk.length
                            
                            if (expectedPayloadLength === 0) {
                                req.payload = Buffer.concat(payloadArr)
                                chunksArr = []
                                totalBytes = 0
                                state = 0
                                header = undefined
                                isHeaderFound = false
                                absoluteLastCRLFCRLFByte = 0
                                payloadArr = []
                            }
                        } else {
                            payloadArr.push(chunk.subarray(0, expectedPayloadLength))
                            req.payload = Buffer.concat(payloadArr)
                            chunksArr = [chunk.subarray(expectedPayloadLength)]
                            totalBytes = chunksArr[0].length
                            state = 0
                            header = undefined
                            isHeaderFound = false
                            expectedPayloadLength = 0
                            absoluteLastCRLFCRLFByte = 0
                            payloadArr = []
                        }
                    } else if (Object.hasOwn(req.headers , 'transfer-encoding')) {
                        
                    } else {
                        socket.destroy();
                        return;
                    }
                }
                if (req.payload !== undefined){
                    console.log(req.payload)
                }
            }
        )
        socket.on('error', (err) => { console.log(err) })
    }
)
server.listen(
    3000,
    () => { console.log('server is listening on port 3000!!') }
)
server.on(
    'error',
    (err) => { console.log(err) }
)
