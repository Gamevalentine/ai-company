import test from 'node:test';
import assert from 'node:assert/strict';
import { hardSecurityChecks, enforceSecurityVerdict, reviewSecurityEvidence } from './security-brain.mjs';

function mockFetch(reply){
  return async()=>({
    ok:true,
    json:async()=>({model:'security-test-model',message:{content:JSON.stringify(reply)}}),
    text:async()=>''
  });
}

function cleanEvidence(){
  return {
    static_scan:{private_key_files:0,committed_env_files:0,credential_like_files:0},
    dependency_audit:{available:true,critical:0,high:0,moderate:0},
    headers:{
      strict_transport_security:true,
      content_security_policy:true,
      x_content_type_options:true
    }
  };
}

test('security hard checks accept clean evidence',()=>{
  const c=hardSecurityChecks(cleanEvidence());
  assert.equal(c.hard_critical,false);
  assert.equal(c.hard_attention,false);
});

test('private key evidence forces CRITICAL',()=>{
  const e=cleanEvidence();
  e.static_scan.private_key_files=1;
  const g=enforceSecurityVerdict(
    {status:'SECURITY_OK',severity:'info',recommended_action:'NO_ACTION',needs_manager_attention:false},
    hardSecurityChecks(e)
  );
  assert.equal(g.status,'CRITICAL');
  assert.equal(g.needs_manager_attention,true);
});

test('high dependency finding cannot be silently reported SECURITY_OK',()=>{
  const e=cleanEvidence();
  e.dependency_audit.high=1;
  const g=enforceSecurityVerdict(
    {status:'SECURITY_OK',severity:'info',recommended_action:'NO_ACTION',needs_manager_attention:false},
    hardSecurityChecks(e)
  );
  assert.equal(g.status,'NEEDS_ATTENTION');
  assert.equal(g.recommended_action,'ESCALATE_DEV');
});

test('security AI report accepts clean supported verdict',async()=>{
  const r=await reviewSecurityEvidence(cleanEvidence(),{fetchImpl:mockFetch({
    status:'SECURITY_OK',
    severity:'info',
    summary:'No critical evidence was found in the supplied checks.',
    findings:['No committed private-key files were reported.'],
    recommended_action:'NO_ACTION',
    needs_manager_attention:false
  })});
  assert.equal(r.agent_id,'SECURITY-TB-01');
  assert.equal(r.status,'SECURITY_OK');
  assert.equal(r.hard_gate_overrode_model,false);
});


test('unavailable dependency audit requires attention',()=>{
  const e=cleanEvidence();
  e.dependency_audit.available=false;
  const g=enforceSecurityVerdict(
    {status:'SECURITY_OK',severity:'info',recommended_action:'NO_ACTION',needs_manager_attention:false},
    hardSecurityChecks(e)
  );
  assert.equal(g.status,'NEEDS_ATTENTION');
  assert.equal(g.needs_manager_attention,true);
});
