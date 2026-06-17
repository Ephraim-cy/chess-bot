/*export default function App() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#1a1a2e',
      color: '#eaeaea',
      fontFamily: 'sans-serif'
    }}>
      <h1>♟ Chess Arena</h1>
      <p>Coming soon...</p>
    </div>
  )
}*/
import { useState, useEffect, useRef } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'

const API = 'https://chess-bot-production-efa2.up.railway.app'
const WSS = 'wss://chess-bot-production-efa2.up.railway.app'

const tg = window.Telegram?.WebApp
const initData = tg?.initData || 'test'
const tgUser = tg?.initDataUnsafe?.user || { id: 0, username: 'Player' }

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  body { font-family: 'Inter', sans-serif; background: #080B14; color: #E8EAF0; overflow-x: hidden; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #2A3550; border-radius: 2px; }
  @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
  @keyframes shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
  @keyframes slide-up { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
  @keyframes glow-pulse { 0%,100%{opacity:.6} 50%{opacity:1} }
  @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  .float { animation: float 3s ease-in-out infinite; }
  .slide-up { animation: slide-up .4s ease forwards; }
  .btn-glow:hover { box-shadow: 0 0 24px rgba(99,102,241,.6) !important; transform: translateY(-2px) !important; }
  .btn-glow:active { transform: translateY(0) !important; }
  .card-hover { transition: all .25s ease; }
  .card-hover:hover { transform: translateY(-2px); }
  input:focus { outline: none; }
`

function injectStyles() {
  if (document.getElementById('chess-styles')) return
  const s = document.createElement('style')
  s.id = 'chess-styles'
  s.textContent = GLOBAL_CSS
  document.head.appendChild(s)
}

const C = {
  bg:'#080B14', bg1:'#0D1117', bg2:'#111827', bg3:'#1A2236',
  border:'rgba(255,255,255,.06)', border2:'rgba(99,102,241,.25)',
  text:'#E8EAF0', muted:'#6B7280',
  accent:'#6366F1', accent2:'#8B5CF6',
  green:'#10B981', red:'#EF4444', gold:'#F59E0B', blue:'#3B82F6',
}
const grad = {
  accent:'linear-gradient(135deg,#6366F1,#8B5CF6)',
  gold:'linear-gradient(135deg,#F59E0B,#EF4444)',
  green:'linear-gradient(135deg,#10B981,#059669)',
  blue:'linear-gradient(135deg,#3B82F6,#6366F1)',
  glow:'radial-gradient(ellipse at top,rgba(99,102,241,.15) 0%,transparent 70%)',
}

function GlowCard({ children, style={}, className='' }) {
  return (
    <div className={`card-hover ${className}`} style={{
      background:C.bg2, border:`1px solid ${C.border}`,
      borderRadius:16, padding:'20px', position:'relative', overflow:'hidden', ...style
    }}>
      <div style={{ position:'absolute', inset:0, borderRadius:16, background:grad.glow, pointerEvents:'none' }}/>
      {children}
    </div>
  )
}

function PrimaryBtn({ children, onClick, disabled, style={}, variant='accent' }) {
  const gradMap = { accent:grad.accent, gold:grad.gold, green:grad.green, blue:grad.blue }
  return (
    <button onClick={onClick} disabled={disabled} className="btn-glow" style={{
      background: disabled ? '#1A2236' : gradMap[variant],
      color: disabled ? C.muted : '#fff', border:'none',
      padding:'13px 28px', borderRadius:12, fontWeight:700,
      fontSize:'.9rem', cursor: disabled ? 'not-allowed' : 'pointer',
      transition:'all .2s ease', letterSpacing:'.3px', width:'100%', ...style
    }}>{children}</button>
  )
}

function StatusBadge({ text, type='info' }) {
  const map = {
    info:    { bg:'rgba(59,130,246,.12)', border:'rgba(59,130,246,.3)', color:'#93C5FD' },
    success: { bg:'rgba(16,185,129,.12)', border:'rgba(16,185,129,.3)', color:'#6EE7B7' },
    warning: { bg:'rgba(245,158,11,.12)', border:'rgba(245,158,11,.3)', color:'#FCD34D' },
    danger:  { bg:'rgba(239,68,68,.12)',  border:'rgba(239,68,68,.3)',  color:'#FCA5A5' },
    purple:  { bg:'rgba(99,102,241,.12)', border:'rgba(99,102,241,.3)', color:'#A5B4FC' },
  }
  const s = map[type] || map.info
  return (
    <div style={{
      background:s.bg, border:`1px solid ${s.border}`, color:s.color,
      borderRadius:10, padding:'10px 16px', fontSize:'.88rem',
      fontWeight:600, textAlign:'center', width:'100%', maxWidth:460,
    }}>{text}</div>
  )
}

function PlayerCard({ name, side, active, captured=[] }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:10,
      background: active ? 'rgba(99,102,241,.08)' : C.bg2,
      border:`1px solid ${active ? C.border2 : C.border}`,
      borderRadius:12, padding:'10px 14px',
      width:'100%', maxWidth:460, transition:'all .3s ease',
      boxShadow: active ? '0 0 20px rgba(99,102,241,.15)' : 'none',
    }}>
      <div style={{
        width:38, height:38, borderRadius:'50%',
        background: side==='white'
          ? 'linear-gradient(135deg,#F8FAFC,#CBD5E1)'
          : 'linear-gradient(135deg,#1E293B,#0F172A)',
        border:`2px solid ${active ? C.accent : C.border}`,
        display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:18, flexShrink:0,
        boxShadow: active ? `0 0 12px ${C.accent}66` : 'none',
        transition:'all .3s',
      }}>{side==='white' ? '♔' : '♚'}</div>
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:700, fontSize:'.88rem', color:C.text }}>{name}</div>
        <div style={{ fontSize:13, marginTop:1 }}>{captured.slice(0,8).join('')}</div>
      </div>
      {active && <div style={{ width:8, height:8, borderRadius:'50%', background:C.green, animation:'glow-pulse 1.5s infinite', boxShadow:`0 0 8px ${C.green}` }}/>}
    </div>
  )
}

function MoveHistory({ moves }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [moves])
  if (!moves.length) return null
  return (
    <div ref={ref} style={{ width:'100%', maxWidth:460, background:C.bg2, border:`1px solid ${C.border}`, borderRadius:12, padding:'10px 12px', maxHeight:76, overflowY:'auto' }}>
      <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 10px' }}>
        {Array.from({ length:Math.ceil(moves.length/2) }, (_,i) => (
          <span key={i} style={{ fontSize:'.78rem', color:C.muted, whiteSpace:'nowrap' }}>
            <span style={{ color:'#374151' }}>{i+1}.</span>{' '}
            <span style={{ color: i*2===moves.length-1 ? C.accent : C.text }}>{moves[i*2]}</span>
            {moves[i*2+1] && <span style={{ color: i*2+1===moves.length-1 ? C.accent : C.text }}> {moves[i*2+1]}</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  useEffect(() => { injectStyles() }, [])

  const [screen,setScreen]         = useState('home')
  const [fen,setFen]               = useState('start')
  const [myTurn,setMyTurn]         = useState(false)
  const [color,setColor]           = useState(null)
  const [matchId,setMatchId]       = useState('')
  const [joinId,setJoinId]         = useState('')
  const [status,setStatus]         = useState('')
  const [statusType,setStatusType] = useState('info')
  const [result,setResult]         = useState(null)
  const [stake,setStake]           = useState('5')
  const [loading,setLoading]       = useState(false)
  const [inCheck,setInCheck]       = useState(false)
  const [moves,setMoves]           = useState([])
  const [capW,setCapW]             = useState([])
  const [capB,setCapB]             = useState([])
  const gameRef = useRef(new Chess())
  const wsRef   = useRef(null)

  useEffect(() => { tg?.ready(); tg?.expand() }, [])

  function setMsg(text,type='info') { setStatus(text); setStatusType(type) }

async function createMatch() {
    setLoading(true)
    setMsg('Creating match...','purple')
    try {
      const stakeNum = parseFloat(stake) || 5
      const res = await fetch(`${API}/api/match/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-init-data': initData || 'test'
        },
        body: JSON.stringify({ stake: stakeNum })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(data))
      setMatchId(data.match_id)
      setColor('white')
      setScreen('lobby')
      connectWS(data.match_id, 'white')
    } catch(e) {
      setMsg('ERROR: ' + e.message, 'danger')
      alert('Error: ' + e.message)
    } finally { setLoading(false) }
  }
  
  async function joinMatch() {
    if (!joinId.trim()) { setMsg('Paste a match ID first','warning'); return }
    setLoading(true); setMsg('Joining...','blue')
    try {
      const res = await fetch(`${API}/api/match/${joinId.trim()}/join`, {
        method:'POST', headers:{ 'x-init-data':initData }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail||'Failed')
      setMatchId(joinId.trim()); setColor('black'); setScreen('game')
      connectWS(joinId.trim(),'black')
    } catch(e) { setMsg('❌ '+e.message,'danger') }
    finally { setLoading(false) }
  }

  function connectWS(mid,clr) {
    const ws = new WebSocket(`${WSS}/ws/${mid}/${clr}`)
    wsRef.current = ws
    ws.onopen = () => setMsg(clr==='white'?'⏳ Waiting for opponent...':'⚡ Game on!','purple')
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data)
      if (msg.type==='connected'||msg.type==='state') {
        const g = gameRef.current
        g.load(msg.fen); setFen(msg.fen)
        setInCheck(msg.in_check && msg.turn===clr)
        const itsMine = msg.turn===clr
        setMyTurn(!msg.game_over && itsMine)
        if (screen!=='game') setScreen('game')
        setMoves(g.history())
        const wC=[],bC=[]
        const syms={p:'♟',n:'♞',b:'♝',r:'♜',q:'♛',P:'♙',N:'♘',B:'♗',R:'♖',Q:'♕'}
        g.history({verbose:true}).forEach(m => {
          if(m.captured){
            const sym=syms[m.color==='w'?m.captured:m.captured.toUpperCase()]||'?'
            if(m.color==='w')wC.push(sym);else bC.push(sym)
          }
        })
        setCapW(wC);setCapB(bC)
        if (!msg.game_over) {
          if(msg.in_check&&itsMine) setMsg('⚠️ You are in Check!','warning')
          else if(itsMine) setMsg('⚡ Your turn!','success')
          else setMsg('⏳ Opponent thinking...','info')
        }
        if (msg.game_over&&msg.result) endGame(msg.result,clr)
      }
      if (msg.type==='gameover') endGame(msg,clr)
      if (msg.type==='error') setMsg('⚠ '+msg.msg,'warning')
    }
    ws.onclose = () => { if(!result) setMsg('🔌 Disconnected','danger') }
    ws.onerror = () => setMsg('❌ Connection failed','danger')
  }

  function endGame(r,clr) {
    setMyTurn(false); setResult(r)
    if(!r.winner) setMsg('½ Draw — '+(r.reason||''),'warning')
    else if(r.winner===clr) setMsg(`🏆 You WIN! +$${(parseFloat(stake)*2*.9).toFixed(2)} USDT`,'success')
    else setMsg('💀 You lost. Better luck next time!','danger')
  }

  function onDrop(from,to) {
    if(!myTurn||result) return false
    const g=gameRef.current
    const mv=g.moves({square:from,verbose:true}).find(m=>m.to===to)
    if(!mv) return false
    const promo=mv.flags.includes('p')?'q':undefined
    if(!g.move({from,to,promotion:promo})) return false
    setFen(g.fen()); setMyTurn(false); setMoves(g.history())
    setMsg('⏳ Opponent thinking...','info')
    wsRef.current?.send(JSON.stringify({type:'move',move:from+to+(promo||'')}))
    return true
  }

  function reset() {
    wsRef.current?.close(); gameRef.current=new Chess()
    setScreen('home');setFen('start');setMyTurn(false);setColor(null)
    setResult(null);setMatchId('');setJoinId('');setStatus('')
    setInCheck(false);setMoves([]);setCapW([]);setCapB([])
  }

  const pool=parseFloat(stake||0)*2, winAmt=pool*.9, fee=pool*.1

  // HOME
  if (screen==='home') return (
    <div style={{ minHeight:'100vh',background:C.bg,display:'flex',flexDirection:'column',alignItems:'center',padding:'24px 14px 40px',gap:16 }}>
      <div className="slide-up" style={{ textAlign:'center',marginBottom:4 }}>
        <div className="float" style={{ fontSize:56,marginBottom:6 }}>♟</div>
        <h1 style={{ fontSize:'2rem',fontWeight:900,letterSpacing:'-1px',background:'linear-gradient(135deg,#A5B4FC,#6366F1,#8B5CF6)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent' }}>
          CHESS ARENA
        </h1>
        <p style={{ color:C.muted,fontSize:'.78rem',marginTop:4,letterSpacing:'2px',textTransform:'uppercase' }}>Real-money · Ultra secure</p>
      </div>

      <div style={{ display:'flex',alignItems:'center',gap:10,background:C.bg2,border:`1px solid ${C.border}`,borderRadius:50,padding:'8px 16px' }}>
        <div style={{ width:28,height:28,borderRadius:'50%',background:grad.accent,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:800 }}>
          {(tgUser.username||'G')[0].toUpperCase()}
        </div>
        <span style={{ fontWeight:600,fontSize:'.85rem' }}>@{tgUser.username||'guest'}</span>
        <div style={{ width:6,height:6,borderRadius:'50%',background:C.green,boxShadow:`0 0 6px ${C.green}` }}/>
      </div>

      <GlowCard style={{ width:'100%',maxWidth:420 }} className="slide-up">
        <p style={{ fontSize:'.72rem',fontWeight:700,color:C.muted,letterSpacing:'1.5px',textTransform:'uppercase',marginBottom:12 }}>💰 Set Your Stake</p>
        <div style={{ display:'flex',gap:6,marginBottom:12 }}>
          {['1','5','10','25','50'].map(v=>(
            <button key={v} onClick={()=>setStake(v)} style={{
              flex:1,padding:'8px 4px',borderRadius:8,
              border:`1px solid ${stake===v?C.accent:C.border}`,
              background:stake===v?'rgba(99,102,241,.15)':'transparent',
              color:stake===v?'#A5B4FC':C.muted,
              fontWeight:700,fontSize:'.8rem',cursor:'pointer',transition:'all .2s',
            }}>${v}</button>
          ))}
        </div>
        <input type="number" value={stake} onChange={e=>setStake(e.target.value)} placeholder="Custom amount..."
          style={{ width:'100%',background:C.bg3,border:`1px solid ${C.border}`,borderRadius:10,padding:'11px 14px',color:C.text,fontSize:'1rem',fontWeight:600,marginBottom:12 }}/>
        <div style={{ background:C.bg3,borderRadius:10,padding:'12px',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,textAlign:'center' }}>
          {[{label:'Prize Pool',value:`$${pool.toFixed(2)}`,color:'#A5B4FC'},{label:'You Win',value:`$${winAmt.toFixed(2)}`,color:C.green},{label:'Platform Fee',value:`$${fee.toFixed(2)}`,color:C.muted}].map(({label,value,color})=>(
            <div key={label}>
              <div style={{ fontSize:'.7rem',color:C.muted,marginBottom:3 }}>{label}</div>
              <div style={{ fontSize:'.95rem',fontWeight:800,color }}>{value}</div>
            </div>
          ))}
        </div>
      </GlowCard>

      <PrimaryBtn onClick={createMatch} disabled={loading} variant="accent" style={{ maxWidth:420,fontSize:'1rem',padding:'15px' }}>
        {loading?'⏳ Creating...':'⚔️ Create New Match'}
      </PrimaryBtn>

      <div style={{ display:'flex',alignItems:'center',gap:10,width:'100%',maxWidth:420 }}>
        <div style={{ flex:1,height:1,background:C.border }}/><span style={{ color:C.muted,fontSize:'.78rem',fontWeight:600 }}>OR JOIN</span><div style={{ flex:1,height:1,background:C.border }}/>
      </div>

      <GlowCard style={{ width:'100%',maxWidth:420 }}>
        <p style={{ fontSize:'.72rem',fontWeight:700,color:C.muted,letterSpacing:'1.5px',textTransform:'uppercase',marginBottom:12 }}>🔗 Join With Match ID</p>
        <input value={joinId} onChange={e=>setJoinId(e.target.value)} placeholder="Paste match ID here..."
          style={{ width:'100%',background:C.bg3,border:`1px solid ${C.border}`,borderRadius:10,padding:'11px 14px',color:C.text,fontSize:'.88rem',marginBottom:12 }}/>
        <PrimaryBtn onClick={joinMatch} disabled={loading||!joinId.trim()} variant="blue">
          {loading?'⏳ Joining...':'🚀 Join Match'}
        </PrimaryBtn>
      </GlowCard>

      {status && <StatusBadge text={status} type={statusType}/>}
      <div style={{ marginTop:4,fontSize:'.72rem',color:'#374151',textAlign:'center',lineHeight:1.8 }}>🔒 Secured · ⚡ Real-time · 💎 10% platform fee</div>
    </div>
  )

  // LOBBY
  if (screen==='lobby') return (
    <div style={{ minHeight:'100vh',background:C.bg,display:'flex',flexDirection:'column',alignItems:'center',padding:'32px 14px',gap:20 }}>
      <div className="float" style={{ fontSize:64 }}>⚔️</div>
      <div style={{ textAlign:'center' }}>
        <h2 style={{ fontSize:'1.5rem',fontWeight:800,background:grad.accent,WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent' }}>Match Created!</h2>
        <p style={{ color:C.muted,fontSize:'.85rem',marginTop:4 }}>Share the ID below with your opponent</p>
      </div>
      <GlowCard style={{ width:'100%',maxWidth:420,textAlign:'center' }}>
        <p style={{ fontSize:'.72rem',fontWeight:700,color:C.muted,letterSpacing:'1.5px',textTransform:'uppercase',marginBottom:12 }}>Match ID</p>
        <div style={{ background:C.bg3,border:`1px solid ${C.border2}`,borderRadius:10,padding:'14px',fontFamily:'monospace',fontSize:'.78rem',wordBreak:'break-all',color:'#A5B4FC',marginBottom:12 }}>{matchId}</div>
        <PrimaryBtn onClick={()=>{ navigator.clipboard.writeText(matchId); setMsg('✅ Copied!','success') }} variant="blue">📋 Copy Match ID</PrimaryBtn>
      </GlowCard>
      <GlowCard style={{ width:'100%',maxWidth:420 }}>
        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,textAlign:'center' }}>
          <div><div style={{ fontSize:'.72rem',color:C.muted,marginBottom:4 }}>Your Stake</div><div style={{ fontSize:'1.1rem',fontWeight:800,color:'#A5B4FC' }}>${parseFloat(stake).toFixed(2)}</div></div>
          <div><div style={{ fontSize:'.72rem',color:C.muted,marginBottom:4 }}>Prize Pool</div><div style={{ fontSize:'1.1rem',fontWeight:800,color:C.green }}>${pool.toFixed(2)}</div></div>
        </div>
      </GlowCard>
      <div style={{ display:'flex',alignItems:'center',gap:12,color:C.muted,fontSize:'.85rem' }}>
        <div style={{ width:16,height:16,border:`2px solid ${C.accent}`,borderTopColor:'transparent',borderRadius:'50%',animation:'spin 1s linear infinite' }}/>
        Waiting for opponent to join...
      </div>
      {status && <StatusBadge text={status} type={statusType}/>}
      <button onClick={reset} style={{ background:'transparent',border:`1px solid ${C.border}`,color:C.muted,padding:'10px 24px',borderRadius:10,cursor:'pointer',fontSize:'.85rem' }}>← Cancel</button>
    </div>
  )

  // GAME
  const whiteName = color==='white' ? (tgUser.username||'You') : 'Opponent'
  const blackName = color==='black' ? (tgUser.username||'You') : 'Opponent'
  const whiteActive = !result && gameRef.current.turn()==='w'
  const blackActive = !result && gameRef.current.turn()==='b'

  return (
    <div style={{ minHeight:'100vh',background:C.bg,display:'flex',flexDirection:'column',alignItems:'center',padding:'12px 10px 28px',gap:10 }}>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',width:'100%',maxWidth:460,marginBottom:2 }}>
        <div>
          <div style={{ fontWeight:800,fontSize:'.95rem',background:grad.accent,WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent' }}>♟ CHESS ARENA</div>
          <div style={{ fontSize:'.72rem',color:C.muted }}>Playing as <span style={{ color:'#A5B4FC',fontWeight:600 }}>{color}</span> · Stake ${parseFloat(stake).toFixed(2)}</div>
        </div>
        {!result && (
          <div style={{ background:whiteActive?'rgba(16,185,129,.1)':'rgba(99,102,241,.1)',border:`1px solid ${whiteActive?'rgba(16,185,129,.3)':C.border2}`,borderRadius:8,padding:'5px 10px',fontSize:'.75rem',fontWeight:700,color:whiteActive?C.green:'#A5B4FC' }}>
            {whiteActive?'⚪ White':'⚫ Black'} to move
          </div>
        )}
      </div>

      <StatusBadge text={status||'♟ Game in progress'} type={statusType}/>
      <PlayerCard name={blackName} side="black" active={blackActive} captured={capB}/>

      <div style={{ width:'min(460px,calc(100vw - 20px))',position:'relative',borderRadius:12,overflow:'hidden',boxShadow:inCheck?`0 0 0 3px ${C.red},0 12px 40px rgba(239,68,68,.3)`:`0 0 0 1px ${C.border},0 12px 40px rgba(0,0,0,.6)`,transition:'box-shadow .3s' }}>
        <Chessboard
          position={fen} onPieceDrop={onDrop}
          boardOrientation={color==='black'?'black':'white'}
          arePiecesDraggable={myTurn&&!result}
          customBoardStyle={{ borderRadius:0 }}
          customDarkSquareStyle={{ backgroundColor:'#B06000' }}
          customLightSquareStyle={{ backgroundColor:'#F0C070' }}
        />
      </div>

      <PlayerCard name={whiteName} side="white" active={whiteActive} captured={capW}/>
      <MoveHistory moves={moves}/>

      <div style={{ width:'100%',maxWidth:460,background:C.bg2,border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
        <div style={{ fontSize:'.75rem',color:C.muted }}>Prize Pool<div style={{ fontSize:'1rem',fontWeight:800,color:C.green }}>${pool.toFixed(2)} USDT</div></div>
        <div style={{ width:1,height:32,background:C.border }}/>
        <div style={{ fontSize:'.75rem',color:C.muted,textAlign:'right' }}>Winner Gets<div style={{ fontSize:'1rem',fontWeight:800,color:'#A5B4FC' }}>${winAmt.toFixed(2)} USDT</div></div>
      </div>

      {result && (
        <div className="slide-up" style={{ width:'100%',maxWidth:460 }}>
          <PrimaryBtn onClick={reset} variant="accent">🔄 Play Again</PrimaryBtn>
        </div>
      )}
    </div>
  )
}