"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SectionLayout from "./section-layout";
import { useMaisChatContext } from "../lib/use-mais-chat-context";
import { supabase } from "../lib/supabase";

type Department = {id:string;name:string;organization_id:string};
type Assignment = {member_id:string;department_id:string};
type Presence = {member_id:string;status:"AVAILABLE"|"AWAY"|"OFFLINE";last_seen_at:string;last_assigned_at:string|null};
type Member = {id:string;role:"OWNER"|"ADMIN"|"AGENT";users:{name:string;email:string}|{name:string;email:string}[]|null};
type InboxRow = {id:string;assigned_member_id:string|null;status:string;last_message_at:string|null;unread_count:number};
type RoutingSettings = {enabled:boolean;default_department_id:string|null};

function memberName(member:Member) {
  const u=Array.isArray(member.users)?member.users[0]:member.users;
  return u?.name || u?.email || "Atendente";
}
function niceTime(value:string|null) {
  if(!value)return "—";
  return new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(value));
}

export default function TeamClient() {
  const ctx=useMaisChatContext();
  const orgId=ctx.membership?.organization_id || null;
  const isAdmin=ctx.membership?.role==="OWNER"||ctx.membership?.role==="ADMIN";
  const [departments,setDepartments]=useState<Department[]>([]);
  const [assignments,setAssignments]=useState<Assignment[]>([]);
  const [members,setMembers]=useState<Member[]>([]);
  const [presence,setPresence]=useState<Presence[]>([]);
  const [conversations,setConversations]=useState<InboxRow[]>([]);
  const [settings,setSettings]=useState<RoutingSettings>({enabled:false,default_department_id:null});
  const [departmentName,setDepartmentName]=useState("");
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [feedback,setFeedback]=useState<string|null>(null);

  const loadBoard=useCallback(async()=>{
    if(!orgId)return;
    const [deps,map,team,online,queue,routing]=await Promise.all([
      supabase.from("team_departments").select("id,name,organization_id")
        .eq("organization_id",orgId).order("name"),
      supabase.from("team_department_members").select("member_id,department_id")
        .eq("organization_id",orgId),
      supabase.from("organization_members").select("id,role,users(name,email)")
        .eq("organization_id",orgId),
      supabase.from("team_member_presence").select("member_id,status,last_seen_at,last_assigned_at")
        .eq("organization_id",orgId),
      supabase.from("conversations").select("id,assigned_member_id,status,last_message_at,unread_count")
        .eq("organization_id",orgId).order("last_message_at",{ascending:false}).limit(1000),
      supabase.from("team_routing_settings").select("enabled,default_department_id")
        .eq("organization_id",orgId).maybeSingle()
    ]);
    if(deps.error||map.error||team.error||online.error||queue.error||routing.error){
      setError("Não foi possível carregar toda a supervisão. "+[deps.error,map.error,team.error,online.error,queue.error,routing.error]
        .filter(Boolean).map(v=>v!.message).join(" · "));
    } else {
      setError(null);
      setDepartments((deps.data||[]) as Department[]);
      setAssignments((map.data||[]) as Assignment[]);
      setMembers((team.data||[]) as Member[]);
      setPresence((online.data||[]) as Presence[]);
      setConversations((queue.data||[]) as InboxRow[]);
      setSettings((routing.data||{enabled:false,default_department_id:null}) as RoutingSettings);
    }
    setLoading(false);
  },[orgId]);

  useEffect(()=>{
    if(!orgId)return;
    void loadBoard();
    const timer=window.setInterval(()=>void loadBoard(),30_000);
    const channel=supabase.channel("team-board:"+orgId)
      .on("postgres_changes",{event:"*",schema:"public",table:"conversations",filter:"organization_id=eq."+orgId},
        ()=>void loadBoard()).subscribe();
    return ()=>{window.clearInterval(timer);void supabase.removeChannel(channel);};
  },[orgId,loadBoard]);

  const openConversations=useMemo(()=>conversations.filter(c=>c.status!=="RESOLVED"),[conversations]);
  const waiting=openConversations.filter(c=>c.assigned_member_id===null);
  const oldestWaiting=waiting.slice().sort((a,b)=>(a.last_message_at||"").localeCompare(b.last_message_at||""))[0];
  const presenceById=new Map(presence.map(p=>[p.member_id,p]));
  const departmentByMember=new Map(assignments.map(x=>[x.member_id,x.department_id]));
  const currentOnline=presence.filter(p=>p.status==="AVAILABLE"&&Date.now()-new Date(p.last_seen_at).getTime()<120_000).length;

  async function saveOperation(work:()=>PromiseLike<{error?:{message:string}|null}>,success:string) {
    if(busy)return;
    setBusy(true);setError(null);setFeedback(null);
    try{
      const result=await work();
      if(result.error)setError(result.error.message);
      else {setFeedback(success);await loadBoard();}
    }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível concluir a operação.");}
    finally{setBusy(false);}
  }
  async function createDepartment(){
    if(!orgId||!isAdmin||departmentName.trim().length<2)return;
    await saveOperation(async()=>{
      const result=await supabase.from("team_departments").insert({organization_id:orgId,name:departmentName.trim()});
      return result;
    },"Setor criado com sucesso.");
    setDepartmentName("");
  }
  async function setMemberDepartment(memberId:string,departmentId:string){
    if(!orgId||!isAdmin)return;
    await saveOperation(async()=>{
      if(!departmentId) return await supabase.from("team_department_members").delete()
        .eq("organization_id",orgId).eq("member_id",memberId);
      return await supabase.from("team_department_members").upsert({
        member_id:memberId,organization_id:orgId,department_id:departmentId
      },{onConflict:"member_id"});
    },"Setor do atendente atualizado.");
  }
  async function updateRouting(next:RoutingSettings){
    if(!orgId||!isAdmin)return;
    await saveOperation(()=>supabase.from("team_routing_settings").upsert({
      organization_id:orgId,enabled:next.enabled,default_department_id:next.default_department_id,
      updated_at:new Date().toISOString()
    },{onConflict:"organization_id"}),next.enabled
      ?"Distribuição ativada para NOVAS mensagens recebidas.":"Distribuição automática desativada.");
  }

  return (
    <SectionLayout active="team" loading={ctx.loading} membership={ctx.membership}
      account={ctx.account} userName={ctx.userName} unread={ctx.unread} error={ctx.error}
      onSignOut={()=>void ctx.signOut()} eyebrow="OPERAÇÃO · MULTIATENDIMENTO"
      title="Equipe e supervisão"
      description="Setores, disponibilidade, fila de atendimento e distribuição. Nenhum envio é iniciado nesta página."
      actions={<Link href="/settings" className="secondaryAction">Gerenciar convites →</Link>}>
      {error&&<div className="teamBoardError" role="alert">{error}</div>}
      {feedback&&<div className="teamBoardInfo" role="status">{feedback}</div>}
      {!isAdmin ? (
        <div className="dataCard teamBoardCard">
          <h2>Minha disponibilidade</h2>
          <p>Defina seu status na lateral. Supervisores podem acompanhar as filas e configurar setores.</p>
          <p>Seu acesso às conversas continua na <Link href="/">caixa de entrada</Link>.</p>
        </div>
      ) : (
        <>
          <div className="teamBoardStats">
            <article><span>Na fila</span><strong>{waiting.length}</strong><small>Sem atendente</small></article>
            <article><span>Em atendimento</span><strong>{openConversations.length-waiting.length}</strong><small>Com responsável</small></article>
            <article><span>Disponíveis</span><strong>{currentOnline}</strong><small>Ativos nos últimos 2 min</small></article>
            <article><span>Mais antiga na fila</span><strong className="teamBoardTime">{oldestWaiting?niceTime(oldestWaiting.last_message_at):"—"}</strong><small>Última mensagem recebida</small></article>
          </div>

          <div className="teamBoardTwoColumns">
            <section className="dataCard teamBoardCard">
              <div className="teamBoardTitle"><div><p className="eyebrow">REGRAS DA FILA</p><h2>Distribuição automática</h2></div>
                <span className={settings.enabled?"teamBoardOn":"teamBoardOff"}>{settings.enabled?"Ativada":"Desativada"}</span>
              </div>
              <p>Distribuição circular por quem estiver <strong>Disponível</strong> e ativo há menos de 2 minutos.
                Respeita o setor selecionado e nunca modifica conversas já atribuídas.</p>
              <label>Setor que receberá os próximos contatos
                <select disabled={busy||loading} value={settings.default_department_id||""}
                  onChange={e=>void updateRouting({...settings,default_department_id:e.target.value||null})}>
                  <option value="">Todos os setores</option>
                  {departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <div className="teamBoardRoutingActions">
                <button disabled={busy||loading} className={settings.enabled?"teamBoardStop":"primaryAction"}
                  type="button" onClick={()=>void updateRouting({...settings,enabled:!settings.enabled})}>
                  {busy?"Salvando...":settings.enabled?"Desativar distribuição":"Ativar distribuição"}
                </button>
              </div>
              <small>O padrão é desligado. Se ninguém estiver disponível, a conversa permanece na fila. Não envia mensagens.</small>
            </section>

            <section className="dataCard teamBoardCard">
              <p className="eyebrow">ORGANIZAÇÃO</p><h2>Setores</h2>
              <p>Crie áreas como Vendas, Suporte e Financeiro e vincule cada atendente ao setor.</p>
              <form className="teamBoardNewDepartment" onSubmit={e=>{e.preventDefault();void createDepartment();}}>
                <input value={departmentName} onChange={e=>setDepartmentName(e.target.value)}
                  placeholder="Nome do novo setor" maxLength={60} required minLength={2}/>
                <button disabled={busy||departmentName.trim().length<2} type="submit">Criar setor</button>
              </form>
              <div className="teamBoardDepartments">
                {departments.map(d=><div key={d.id}><strong>{d.name}</strong><span>{assignments.filter(a=>a.department_id===d.id).length} integrante(s)</span></div>)}
                {!departments.length&&<p>Nenhum setor cadastrado. Você pode começar sem setores.</p>}
              </div>
            </section>
          </div>

          <section className="dataCard teamBoardCard">
            <div className="teamBoardTitle"><div><p className="eyebrow">SUPERVISÃO AO VIVO</p><h2>Atendentes e capacidade</h2></div>
              <button type="button" disabled={busy} onClick={()=>void loadBoard()} className="teamBoardRefresh">Atualizar</button>
            </div>
            <div className="teamBoardMembers">
              {members.map(m=>{
                const p=presenceById.get(m.id);
                const live=Boolean(p&&Date.now()-new Date(p.last_seen_at).getTime()<120_000);
                const state=p?.status==="AVAILABLE"&&live?"Disponível":p?.status==="AWAY"&&live?"Ausente":"Indisponível";
                const activeCount=openConversations.filter(c=>c.assigned_member_id===m.id).length;
                return <article className="teamBoardMember" key={m.id}>
                  <div className="teamBoardAvatar">{memberName(m).slice(0,2).toUpperCase()}</div>
                  <div className="teamBoardMemberInfo"><strong>{memberName(m)}</strong>
                    <span>{m.role==="OWNER"?"Proprietário":m.role==="ADMIN"?"Administrador":"Atendente"}</span>
                    <small className={state==="Disponível"?"teamBoardAvailable":""}>{state} · {activeCount} conversa(s)</small>
                  </div>
                  <label>Setor
                    <select value={departmentByMember.get(m.id)||""} disabled={busy}
                      onChange={e=>void setMemberDepartment(m.id,e.target.value)}>
                      <option value="">Sem setor</option>
                      {departments.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}
                    </select>
                  </label>
                  <div className="teamBoardMemberCount"><strong>{activeCount}</strong><small>atribuídas</small></div>
                </article>;
              })}
            </div>
          </section>
          <section className="dataCard teamBoardCard">
            <p className="eyebrow">FILA DE NOVOS</p><h2>Conversas aguardando responsável</h2>
            <p>{waiting.length} conversa(s) sem atendente entre as {conversations.length} mais recentes consultadas.
              Use a caixa de entrada para assumir ou transferir.</p>
            <Link href="/" className="secondaryAction">Abrir caixa de entrada →</Link>
          </section>
        </>
      )}
    </SectionLayout>
  );
}
