import forge from "node-forge";
import crypto from "node:crypto";
import tls from "node:tls";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";

export class CertificateManager {
  private caKey!: forge.pki.rsa.PrivateKey;
  private caCert!: forge.pki.Certificate;
  private certCache = new Map<string, tls.SecureContext>();
  private certDataCache = new Map<string, { key: string; cert: string }>();

  private certDir: string;
  private caKeyPath: string;
  private caCertPath: string;

  constructor() {
    this.certDir = path.join(os.homedir(), ".cmux", "certs");
    this.caKeyPath = path.join(this.certDir, "ca.key");
    this.caCertPath = path.join(this.certDir, "ca.crt");
    
    if (!fs.existsSync(this.certDir)) {
      fs.mkdirSync(this.certDir, { recursive: true });
    }

    if (fs.existsSync(this.caKeyPath) && fs.existsSync(this.caCertPath)) {
      this.loadCa();
    } else {
      this.generateCa();
      this.saveCa();
    }
  }

  private loadCa() {
    const keyPem = fs.readFileSync(this.caKeyPath, "utf8");
    const certPem = fs.readFileSync(this.caCertPath, "utf8");
    this.caKey = forge.pki.privateKeyFromPem(keyPem);
    this.caCert = forge.pki.certificateFromPem(certPem);
  }

  private saveCa() {
    const keyPem = forge.pki.privateKeyToPem(this.caKey);
    const certPem = forge.pki.certificateToPem(this.caCert);
    fs.writeFileSync(this.caKeyPath, keyPem, { mode: 0o600 });
    fs.writeFileSync(this.caCertPath, certPem);
  }

  private generateCa() {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    this.caKey = keys.privateKey;
    this.caCert = forge.pki.createCertificate();
    this.caCert.publicKey = keys.publicKey;
    this.caCert.serialNumber = "01";
    this.caCert.validity.notBefore = new Date();
    this.caCert.validity.notAfter = new Date();
    this.caCert.validity.notAfter.setFullYear(
      this.caCert.validity.notBefore.getFullYear() + 10
    );
    const attrs = [
      { name: "commonName", value: "Cmux Preview Proxy CA" },
      { name: "countryName", value: "US" },
      { shortName: "ST", value: "California" },
      { name: "localityName", value: "San Francisco" },
      { name: "organizationName", value: "Cmux" },
      { shortName: "OU", value: "Preview Proxy" },
    ];
    this.caCert.setSubject(attrs);
    this.caCert.setIssuer(attrs);
    this.caCert.setExtensions([
      { name: "basicConstraints", cA: true, critical: true },
      {
        name: "keyUsage",
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true,
      },
    ]);
    this.caCert.sign(this.caKey, forge.md.sha256.create());
  }

  getSecureContextForHost(hostname: string): tls.SecureContext {
    const cached = this.certCache.get(hostname);
    if (cached) {
      return cached;
    }

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = this.generateSerialNumber();
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(
      cert.validity.notBefore.getFullYear() + 1
    );

    const attrs = [
      { name: "commonName", value: hostname },
      { name: "organizationName", value: "Cmux Preview" },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(this.caCert.subject.attributes);
    cert.setExtensions([
      { name: "basicConstraints", cA: false },
      {
        name: "keyUsage",
        digitalSignature: true,
        keyEncipherment: true,
      },
      {
        name: "subjectAltName",
        altNames: [
          {
            type: 2, // DNS
            value: hostname,
          },
          ...(net.isIP(hostname) ? [{
            type: 7, // IP
            ip: hostname,
          }] : []),
        ],
      },
    ]);
    cert.sign(this.caKey as forge.pki.rsa.PrivateKey, forge.md.sha256.create());

    const pemKey = forge.pki.privateKeyToPem(keys.privateKey);
    const pemCert = forge.pki.certificateToPem(cert);
    const caPem = forge.pki.certificateToPem(this.caCert);

    const context = tls.createSecureContext({
      key: pemKey,
      cert: pemCert,
      ca: caPem,
    });

    this.certCache.set(hostname, context);


    return context;
  }

  getCertDataForHost(hostname: string): { key: string; cert: string } {
    // Check cache first (we need a separate cache for raw data or extract from secure context)
    // For simplicity, let's use a separate cache for now or just reuse the logic if we can extract.
    // Actually, we can't easily extract PEM from SecureContext.
    // So let's add a data cache.
    if (this.certDataCache.has(hostname)) {

      return this.certDataCache.get(hostname)!;
    }

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = this.generateSerialNumber();
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(
      cert.validity.notBefore.getFullYear() + 1
    );

    const attrs = [
      { name: "commonName", value: hostname },
      { name: "organizationName", value: "Cmux Preview" },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(this.caCert.subject.attributes);
    cert.setExtensions([
      { name: "basicConstraints", cA: false },
      {
        name: "keyUsage",
        digitalSignature: true,
        keyEncipherment: true,
      },
      {
        name: "subjectAltName",
        altNames: [
          {
            type: 2, // DNS
            value: hostname,
          },
          ...(net.isIP(hostname) ? [{
            type: 7, // IP
            ip: hostname,
          }] : []),
        ],
      },
    ]);
    cert.sign(this.caKey as forge.pki.rsa.PrivateKey, forge.md.sha256.create());

    const pemKey = forge.pki.privateKeyToPem(keys.privateKey);
    const pemCert = forge.pki.certificateToPem(cert);
    


    const data = { key: pemKey, cert: pemCert };
    this.certDataCache.set(hostname, data);
    return data;
  }

  getCaCert(): string {
    return forge.pki.certificateToPem(this.caCert);
  }

  getCaSpkiFingerprint(): string {
    const asn1 = forge.pki.publicKeyToAsn1(this.caCert.publicKey);
    const der = forge.asn1.toDer(asn1).getBytes();
    const md = forge.md.sha256.create();
    md.update(der);
    return forge.util.encode64(md.digest().getBytes());
  }

  private generateSerialNumber(): string {
    return crypto.randomBytes(16).toString("hex");
  }
}
