import { createHash } from 'node:crypto';
export const QUALITY_VECTOR_SCHEMA_ID='atm.qualityVector.v1' as const;
export function compileQualityVector(input:{readonly authorityDigest:string;readonly dimensions:Readonly<Record<string,number>>;readonly nonClaims?:readonly string[]}){
  const dimensions:Record<string,number>={}; for(const key of Object.keys(input.dimensions??{}).sort()) dimensions[key]=Number(input.dimensions[key]);
  const diagnostics:string[]=[]; if(!input.authorityDigest) diagnostics.push('authority-incomplete'); for(const value of Object.values(dimensions)) if(!Number.isFinite(value)||value<0||value>1) diagnostics.push('dimension-out-of-range');
  const status=diagnostics.length?'blocked':'proven'; const nonClaims=input.nonClaims??['vector-is-not-a-close-authority']; const payload={authorityDigest:input.authorityDigest,dimensions,nonClaims,status,diagnostics};
  return{schemaId:QUALITY_VECTOR_SCHEMA_ID,specVersion:'0.1.0' as const,authorityDigest:input.authorityDigest,dimensions,nonClaims,status,diagnostics,repairCommand:diagnostics.length?'normalize dimensions to [0,1] and reseal authority':null,resultDigest:`sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`};
}
