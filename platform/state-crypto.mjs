import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ALG='aes-256-gcm';

export function encryptState(state, privateKeyPem){
  if(!privateKeyPem) throw new Error('Missing state encryption private key');
  const dataKey=crypto.randomBytes(32);
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv(ALG,dataKey,iv);
  const plaintext=Buffer.from(JSON.stringify(state));
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  const tag=cipher.getAuthTag();
  const publicKey=crypto.createPublicKey(privateKeyPem);
  const wrappedKey=crypto.publicEncrypt({
    key:publicKey,
    padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash:'sha256'
  },dataKey);
  return {
    version:1,
    scheme:'RSA-OAEP-SHA256+AES-256-GCM',
    wrapped_key:wrappedKey.toString('base64'),
    iv:iv.toString('base64'),
    auth_tag:tag.toString('base64'),
    ciphertext:ciphertext.toString('base64')
  };
}

export function decryptState(envelope, privateKeyPem){
  if(!privateKeyPem) throw new Error('Missing state encryption private key');
  if(!envelope||envelope.scheme!=='RSA-OAEP-SHA256+AES-256-GCM') throw new Error('Unsupported state envelope');
  const dataKey=crypto.privateDecrypt({
    key:privateKeyPem,
    padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash:'sha256'
  },Buffer.from(envelope.wrapped_key,'base64'));
  const decipher=crypto.createDecipheriv(ALG,dataKey,Buffer.from(envelope.iv,'base64'));
  decipher.setAuthTag(Buffer.from(envelope.auth_tag,'base64'));
  const plaintext=Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext,'base64')),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

function arg(name){
  const i=process.argv.indexOf(name);
  return i>=0?process.argv[i+1]:null;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const mode=process.argv[2];
  const input=arg('--input');
  const output=arg('--output');
  const key=process.env.AION_STATE_PRIVATE_KEY;
  if(!mode||!input||!output||!key) throw new Error('Usage: state-crypto.mjs <encrypt|decrypt> --input <file> --output <file> with AION_STATE_PRIVATE_KEY');
  if(mode==='encrypt'){
    const state=JSON.parse(fs.readFileSync(input,'utf8'));
    fs.writeFileSync(output,JSON.stringify(encryptState(state,key),null,2)+'\n');
  } else if(mode==='decrypt'){
    const envelope=JSON.parse(fs.readFileSync(input,'utf8'));
    fs.writeFileSync(output,JSON.stringify(decryptState(envelope,key),null,2)+'\n');
  } else {
    throw new Error('Unsupported mode: '+mode);
  }
}
