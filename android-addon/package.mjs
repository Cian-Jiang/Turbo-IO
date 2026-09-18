// Mechanical transformation of a private, locally supplied APK derivative.
// Does not remove login, signature checks, certificate pinning or app licensing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const host=path.join(root,'build/host-104');
const source=process.argv[2];
if(!source) throw new Error('Usage: node android-addon/package.mjs /path/to/RayNeo_AI_1.0.4.apk');
const dex=path.join(root,'build/dex/classes.dex');
if(!fs.existsSync(dex)) throw new Error('Build the original addon first: bash android-addon/build.sh');
const sha=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
if(sha!=='ef2e7dd346ca478e13d0f3f1bf31fa61412e44fb9b4ca9cf0d3e864ac608584b') throw new Error('Unsupported APK; refusing to guess offsets/classes');
if(!fs.existsSync(host)) execFileSync('apktool',['d','--no-res','--output',host,source],{stdio:'inherit'});

function wrap(file,name,signature,args,returnMode) {
  let text=fs.readFileSync(file,'utf8');
  const original='turboioOriginal_'+name;
  const header='.method public final '+name+signature;
  // Replace our generated wrapper on repeated builds, retain the original body.
  if(text.includes(original+'(')) {
    const start=text.indexOf(header+'\n');
    if(start<0)throw new Error('Generated wrapper missing');
    const end=text.indexOf('.end method',start);
    text=text.slice(0,start)+text.slice(end+'.end method'.length);
  } else {
  if(text.split(header).length!==2) throw new Error('Method signature mismatch: '+name);
  text=text.replace(header,'.method public final '+original+signature);
  }
  const className=text.match(/^\.class[^\n]* (L[^;]+;)$/m)?.[1];
  if(!className) throw new Error('Class header missing');
  const invoke='invoke-virtual/range {'+args+'}, '+className+'->'+original+signature;
  const map={onAsrResult:'dispatchAsr(Ljava/lang/Object;Ljava/lang/String;ZLjava/lang/String;)V',
    onNlpResult:'dispatchNlp(Ljava/lang/Object;Ljava/lang/Object;)V',onResponseComplete:'dispatchComplete(Ljava/lang/Object;)V',
    onPostResume:'install(Landroid/app/Activity;)V'};
  const bridge='invoke-static/range {'+args+'}, Lcom/turboio/addon/TurboAddon;->'+map[name];
  const body=name!=='onPostResume'
    ? `    :turboio_try\n    ${bridge}\n    :turboio_try_end\n    return-void\n    :turboio_error\n    move-exception v0\n    ${invoke}\n    return-void`
    : `    ${invoke}\n    :turboio_try\n    ${bridge}\n    :turboio_try_end\n    return-void\n    :turboio_error\n    move-exception v0\n    return-void`;
  text+='\n'+header+'\n    .locals 1\n'+body+'\n    .catch Ljava/lang/Throwable; {:turboio_try .. :turboio_try_end} :turboio_error\n.end method\n';
  fs.writeFileSync(file,text);
}
const listener=path.join(host,'smali_classes2/H7/c$c.smali');
wrap(listener,'onAsrResult','(Ljava/lang/String;ZLjava/lang/String;)V','p0 .. p3','after');
wrap(listener,'onNlpResult','(Lcom/rayneo/airuntime/controller/NlpResult;)V','p0 .. p1','guard');
wrap(listener,'onResponseComplete','()V','p0 .. p0','guard');
wrap(path.join(host,'smali_classes2/com/rayneo/venus/MainActivity.smali'),'onPostResume','()V','p0 .. p0','after');
// Preserve all official event delivery, observe only business-19 metadata afterward.
const eventFile=path.join(host,'smali_classes2/com/rayneo/rayneo_venus_sdk_plugin/j.smali');
let eventText=fs.readFileSync(eventFile,'utf8');
const eventHeader='.method public final z(Ljava/lang/String;Ljava/util/Map;)V';
if(eventText.includes('turboioOriginal_z(')) {
  const start=eventText.indexOf(eventHeader+'\n');if(start<0)throw new Error('Missing event wrapper');
  const end=eventText.indexOf('.end method',start);eventText=eventText.slice(0,start)+eventText.slice(end+11);
} else {
  if(eventText.split(eventHeader).length!==2)throw new Error('Event signature mismatch');
  eventText=eventText.replace(eventHeader,'.method public final turboioOriginal_z(Ljava/lang/String;Ljava/util/Map;)V');
}
eventText+='\n'+eventHeader+`\n    .locals 1
    invoke-virtual {p0, p1, p2}, Lcom/rayneo/rayneo_venus_sdk_plugin/j;->turboioOriginal_z(Ljava/lang/String;Ljava/util/Map;)V
    :turboio_nav_try
    invoke-static {p1, p2}, Lcom/turboio/addon/NavGlasses;->event(Ljava/lang/String;Ljava/util/Map;)V
    :turboio_nav_end
    return-void
    :turboio_nav_error
    move-exception v0
    return-void
    .catch Ljava/lang/Throwable; {:turboio_nav_try .. :turboio_nav_end} :turboio_nav_error
.end method\n`;
fs.writeFileSync(eventFile,eventText);
const output=path.join(root,'build/TurboIO-RayNeo-1.0.4-unsigned.apk');
const rebuilt=path.join(root,'build/host-rebuilt.apk');
execFileSync('apktool',['b',host,'-o',rebuilt],{stdio:'inherit'});
execFileSync('python3',[path.join(root,'assemble-apk.py'),source,rebuilt,dex,output],{stdio:'inherit'});
const report={sourceSha256:sha,sourceVersion:'1.0.4 (195)',originalSignaturePreserved:false,
  changes:['ASR observer','NLP/complete guards','onPostResume native entry','business19 display events','classes4.dex addon'],
  credentialsBundled:false,outputSha256:crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex'),
  installed:false,nonRootValidated:false};
fs.writeFileSync(path.join(root,'build/package-report.json'),JSON.stringify(report,null,2)+'\n');
console.log('Unsigned private derivative prepared; signing and non-root acceptance still required.');
