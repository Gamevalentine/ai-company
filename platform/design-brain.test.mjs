import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AionPlatform } from './runtime.mjs';
import { runDesignBrain, validateDesignDecision } from './design-brain.mjs';

function fakeFetch(payload){
  return async()=>({
    ok:true,
    async json(){
      return {model:'design-test-model',message:{content:JSON.stringify(payload)}};
    },
    async text(){ return ''; }
  });
}

function designPayload(overrides={}){
  return {
    design_goal:'Làm luồng nhiệm vụ rõ ràng và dễ dùng hơn.',
    user_problem:'Người dùng khó biết bước tiếp theo sau khi mở nhiệm vụ.',
    assumptions:['Giữ nguyên hệ màu và typography hiện tại.'],
    user_flow:['Mở nhiệm vụ','Xem trạng thái','Thực hiện hành động chính','Nhận phản hồi kết quả'],
    layout_components:['Header nhiệm vụ','Khối trạng thái','Nút hành động chính','Khu vực bằng chứng'],
    interaction_states:['Loading khi tải nhiệm vụ','Empty khi chưa có bằng chứng','Error khi thao tác thất bại','Success sau khi lưu'],
    visual_direction:['Ưu tiên phân cấp rõ','Giữ phong cách AION HQ hiện tại'],
    responsive_rules:['Desktop dùng hai cột khi đủ chỗ','Mobile chuyển một cột và nút chính full-width'],
    accessibility_checks:['Có focus visible','Nút có nhãn rõ','Touch target tối thiểu phù hợp'],
    acceptance_criteria:['Người dùng thấy trạng thái ngay khi mở','Luồng chính dùng được trên mobile và desktop'],
    implementation_notes:['Tái sử dụng component hiện có nếu phù hợp.'],
    open_questions:[],
    needs_owner_decision:false,
    owner_decision_reason:'',
    ...overrides
  };
}

function stateFor(task){
  return {tasks:[task],messages:[],memories:[],executions:[],audit:[]};
}

test('DESIGN-01 is a direct ATLAS report in runtime registry',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aion-design-'));
  const p=new AionPlatform({dataDir:dir});
  const agent=p.agent('DESIGN-01');
  assert.equal(agent.reports_to,'ATLAS');
  assert.ok(p.agent('ATLAS').can_assign_to.includes('DESIGN-01'));
  const task=p.createTask('ATLAS',{
    assigned_to:'DESIGN-01',
    project:'TrainingBot',
    objective:'Thiết kế lại luồng nhiệm vụ'
  });
  assert.equal(task.assigned_to,'DESIGN-01');
});

test('DESIGN-01 produces traceable handoff and reports to ATLAS',async()=>{
  const task={
    task_id:'DESIGN-TASK-001',
    project:'TrainingBot',
    created_by:'ATLAS',
    assigned_to:'DESIGN-01',
    objective:'Cải thiện luồng nhiệm vụ',
    scope:'UI only',
    acceptance_criteria:['Có mobile'],
    status:'QUEUED',
    inputs:{evidence:['screenshot supplied by CEO']},
    outputs:{},
    evidence:[]
  };
  const out=await runDesignBrain(stateFor(task),{
    taskId:task.task_id,
    fetchImpl:fakeFetch(designPayload())
  });
  const updated=out.state.tasks[0];
  assert.equal(updated.status,'READY_FOR_CEO_REVIEW');
  assert.equal(updated.outputs.design_handoff.agent_id,'DESIGN-01');
  assert.equal(updated.outputs.design_handoff.model,'design-test-model');
  assert.ok(updated.evidence.some(e=>e.type==='DESIGN_HANDOFF'));
  assert.ok(out.state.messages.some(m=>m.from==='DESIGN-01'&&m.to==='ATLAS'&&m.type==='DESIGN_HANDOFF_READY'));
});

test('DESIGN-01 escalates material product decision instead of guessing',async()=>{
  const task={
    task_id:'DESIGN-TASK-002',
    project:'TrainingBot',
    created_by:'ATLAS',
    assigned_to:'DESIGN-01',
    objective:'Thay đổi luồng thanh toán',
    scope:'UX',
    acceptance_criteria:[],
    status:'QUEUED',
    inputs:{},
    outputs:{},
    evidence:[]
  };
  const out=await runDesignBrain(stateFor(task),{
    taskId:task.task_id,
    fetchImpl:fakeFetch(designPayload({
      needs_owner_decision:true,
      owner_decision_reason:'Cần Owner chọn giữa thanh toán một bước và nhiều bước vì ảnh hưởng hành vi mua hàng.',
      open_questions:['Owner chọn luồng thanh toán nào?']
    }))
  });
  assert.equal(out.state.tasks[0].status,'WAITING_CEO_DECISION');
  assert.ok(out.state.messages.some(m=>m.type==='DESIGN_DECISION_REQUIRED'));
});

test('DESIGN-01 refuses work assigned to another agent',async()=>{
  const task={
    task_id:'DESIGN-TASK-003',
    project:'TrainingBot',
    created_by:'ATLAS',
    assigned_to:'CODE-01',
    objective:'Không phải việc DESIGN-01',
    status:'QUEUED',
    inputs:{},
    outputs:{},
    evidence:[]
  };
  await assert.rejects(
    ()=>runDesignBrain(stateFor(task),{taskId:task.task_id,fetchImpl:fakeFetch(designPayload())}),
    /cannot process task assigned to CODE-01/
  );
});

test('design output validator rejects incomplete handoff',()=>{
  assert.throws(()=>validateDesignDecision({design_goal:'x'}),/user_problem is required/);
});
