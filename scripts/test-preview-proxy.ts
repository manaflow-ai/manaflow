import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import http2 from "node:http2";
import { 
    startPreviewProxy, 
    setPreviewProxyLoggingEnabled, 
    configurePreviewProxyForView, 
    getProxyCredentialsForWebContents 
} from "../apps/client/electron/main/task-run-preview-proxy";
import { CertificateManager } from "../apps/client/electron/main/preview-proxy-certs";

// Set test environment variables
process.env.TEST_CMUX_PROXY_ORIGIN = "https://127.0.0.1:8081";
process.env.TEST_ALLOW_INSECURE_UPSTREAM = "true";

// Mock logger
const logger = {
  log: (...args: any[]) => console.log("[LOG]", ...args),
  warn: (...args: any[]) => console.warn("[WARN]", ...args),
  error: (...args: any[]) => console.error("[ERROR]", ...args),
};

const MOCK_WEB_CONTENTS_ID = 123;

const mockWebContents = {
    id: MOCK_WEB_CONTENTS_ID,
    session: {
        setProxy: async (config: any) => {
            console.log("[MOCK] setProxy called with:", config);
        }
    },
    once: (event: string, listener: Function) => {
        console.log(`[MOCK] once listener added for ${event}`);
    }
};

async function connectToProxy(targetHost: string, targetPort: number, credentials: {username: string, password: string}, proxyPort: number) {
    return new Promise<{ tlsSocket: tls.TLSSocket; socket: net.Socket }>((resolve, reject) => {
        const socket = net.connect(proxyPort, "127.0.0.1");
        socket.setNoDelay(true);

        socket.on("connect", () => {
            console.log("Connected to proxy");
            const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64");
            const request = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
                            `Host: ${targetHost}:${targetPort}\r\n` +
                            `Proxy-Authorization: Basic ${auth}\r\n` +
                            `\r\n`;
            socket.write(request);
        });

        socket.once("data", (data) => {
            const response = data.toString();
            if (response.includes("200 Connection Established") || response.includes("200 OK")) {
                console.log("\nTunnel established! Starting TLS handshake...");
                
                const certManager = new CertificateManager();
                const caCert = certManager.getCaCert();

                const tlsSocket = tls.connect({
                    socket: socket,
                    rejectUnauthorized: true, 
                    ca: caCert,
                    ALPNProtocols: ["h2", "http/1.1"],
                    servername: targetHost,
                });
                
                tlsSocket.on("secureConnect", () => {
                    resolve({ tlsSocket, socket });
                });

                tlsSocket.on("error", (err) => {
                    console.error("TLS Error:", err);
                    reject(err);
                });
            } else {
                reject(new Error(`Proxy connection failed: ${response}`));
            }
        });

        socket.on("error", (err) => {
            reject(err);
        });
    });
}

async function runTests() {
    console.log("Starting preview proxy test...");
    setPreviewProxyLoggingEnabled(true);
    
    // 1. Start the proxy
    const port = await startPreviewProxy(logger);
    console.log(`Proxy started on port ${port}`);

    // Start dummy upstream server
    const certManager = new CertificateManager();
    const { key, cert } = certManager.getCertDataForHost("localhost");
    
    const dummyServer = http2.createSecureServer({ key, cert });
    let lastSession: http2.Http2Session | undefined;
    dummyServer.on('stream', (stream, headers) => {
        console.log("[Dummy Upstream] Received stream");
        if (lastSession) {
            if (stream.session === lastSession) {
                console.log("[Dummy Upstream] REUSED SESSION!");
            } else {
                console.log("[Dummy Upstream] NEW SESSION (not reused)");
            }
        } else {
            console.log("[Dummy Upstream] First session");
        }
        lastSession = stream.session;

        stream.respond({
            ':status': 200,
            'content-type': 'text/plain',
            'cache-control': 'max-age=3600',
            'etag': '"test-etag"',
        });
        stream.end('Hello from dummy upstream!');
    });
    
    await new Promise<void>(resolve => dummyServer.listen(8081, () => resolve()));
    console.log("Dummy upstream started on port 8081");
    
    process.env.TEST_CMUX_PROXY_ORIGIN = "https://127.0.0.1:8081";
    process.env.TEST_ALLOW_INSECURE_UPSTREAM = "true";

    // 2. Configure a session
    // We use a URL that matches the cmux pattern to ensure a route is derived.
    const initialUrl = "http://cmux-test-base-8080.cmux.local";
    await configurePreviewProxyForView({
        webContents: mockWebContents as any,
        initialUrl,
        logger,
        persistKey: "test-persist-key"
    });

    // 3. Get credentials
    const credentials = getProxyCredentialsForWebContents(MOCK_WEB_CONTENTS_ID);
    if (!credentials) {
        throw new Error("Failed to get credentials for mock web contents");
    }
    console.log("Credentials obtained:", credentials);

    try {
        console.log("\n--- Test 1: HTTPS Connect (MITM) ---");
        const { tlsSocket: tlsSocket1, socket: socket1 } = await connectToProxy("cmux-test-base-8080.cmux.local", 443, credentials, port);
        
        console.log("TLS Handshake successful!");
        const cert = tlsSocket1.getPeerCertificate();
        console.log("Peer Certificate Subject:", cert.subject);
        console.log("ALPN Protocol:", tlsSocket1.alpnProtocol);
        console.log("Cipher:", tlsSocket1.getCipher());
        
        if (tlsSocket1.alpnProtocol === 'h2') {
             console.log("HTTP/2 negotiated!");
        } else {
             console.log("HTTP/1.1 negotiated (or no ALPN)");
        }
        
        tlsSocket1.end();
        socket1.destroy();


        console.log("\n--- Test 2: HTTP/2 Request (MITM) ---");
        const { tlsSocket: tlsSocket2, socket: socket2 } = await connectToProxy("cmux-test-base-8080.cmux.local", 443, credentials, port);
        
        if (tlsSocket2.alpnProtocol !== 'h2') {
            throw new Error("HTTP/2 not negotiated for Test 2");
        }

        await new Promise<void>((resolve, reject) => {
            const session = http2.connect("https://cmux-test-base-8080.cmux.local", {
                createConnection: () => tlsSocket2
            });

            session.on('error', (err) => {
                console.error("HTTP/2 Session Error:", err);
                reject(err);
            });

            let reqCount = 0;
            const makeRequest = () => {
                reqCount++;
                console.log(`Sending HTTP/2 Request ${reqCount}...`);
                const req = session.request({
                    ':path': '/',
                    ':method': 'GET'
                });

                req.on('response', (headers) => {
                    console.log(`HTTP/2 Response ${reqCount} Headers:`, headers);
                    if (headers['cache-control'] !== 'max-age=3600') {
                        reject(new Error(`Missing or incorrect cache-control header. Got: ${headers['cache-control']}`));
                    }
                });

                req.setEncoding('utf8');
                let data = '';
                req.on('data', (chunk) => { data += chunk; });
                req.on('end', () => {
                    console.log(`HTTP/2 Response ${reqCount} Body:`, data);
                    if (reqCount < 2) {
                        // Send second request
                        makeRequest();
                    } else {
                        session.close();
                        socket2.destroy();
                        resolve();
                    }
                });
                req.end();
            };

            makeRequest();
        });

        console.log("\n--- Test 3: IP Address Connect (MITM) ---");
        const { tlsSocket: tlsSocket3, socket: socket3 } = await connectToProxy("127.0.0.1", 8081, credentials, port);
        
        console.log("TLS Handshake successful for IP!");
        const cert3 = tlsSocket3.getPeerCertificate();
        console.log("Peer Certificate Subject:", cert3.subject);
        console.log("Peer Certificate SANs:", cert3.subjectaltname);
        
        if (!cert3.subjectaltname || !cert3.subjectaltname.includes("IP Address:127.0.0.1")) {
             // Node's subjectaltname format: "DNS:example.com, IP Address:1.2.3.4"
             if (!cert3.subjectaltname?.includes("127.0.0.1")) {
                 throw new Error(`Certificate missing IP SAN for 127.0.0.1. Got: ${cert3.subjectaltname}`);
             }
        }
        console.log("Verified IP SAN present.");

        tlsSocket3.end();
        socket3.destroy();

        console.log("\nTests completed.");
    } catch (err) {
        console.error("\nTest failed:", err);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
