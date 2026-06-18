import { useState, useEffect, useRef } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'

// Production URLs matching your active backend deployment
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
  @keyframes glow-pulse { 0%,100%{opacity:.6} 50%{opacity:1} }
  @keyframes slide-up { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
  .float { animation: float 3s ease-in-out infinite; }
  .slide-up { animation: slide-up .4s ease forwards; }
  .btn-glow:hover { box-shadow: 0 0 24px rgba(99,102,241,.6) !important; transform: translateY(-2px) !important; }
  .btn-glow:active { transform: translateY(0) !important; }
  .card-hover { transition: all .25s ease; }
  .card-hover:hover { transform: translateY(-2px); }
  input:focus { outline: none; border-color: #6366F1 !important; }
`

function injectStyles() {
  if (document.getElementById('chess-styles')) return
  const s = document.createElement('style')
  s.id = 'chess-styles'
  s.textContent = GLOBAL_CSS
  document.head.appendChild(s)
}

const C = {
  bg: '#080B14', bg2: '#111827', bg3: '#1A2236',
  border: 'rgba(255,255,255,.06)', border2: 'rgba(99,102,241,.25)',
  text: '#E8EAF0', muted: '#6B7280', accent: '#6366F1',
  green: '#10B981', red: '#EF4444', purple: '#8B5CF6', blue: '#3B82F6'
}

const grad = {
  accent: 'linear-gradient(135deg,#6366F1,#8B5CF6)',
  blue: 'linear-gradient(135deg,#3B82F6,#6366F1)',
  glow: 'radial-gradient(ellipse at top,rgba(99,102,241,.15) 0%,transparent 70%)'
}

function GlowCard({ children, style = {}, className = '' }) {
  return (
    <div className={`card-hover ${className}`} style={{
      background: C.bg2, border: `1px solid ${C.border}`,
      borderRadius: 16, padding: '20px', position: 'relative', overflow: 'hidden', ...style
    }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 16, background: grad.glow, pointerEvents: 'none' }} />
      {children}
    </div>
  )
}

function PrimaryBtn({ children, onClick, disabled, style = {}, variant = 'accent' }) {
  const gradMap = { accent: grad.accent, blue: grad.blue }
  return (
    <button onClick={onClick} disabled={disabled} className="btn-glow" style={{
      background: disabled ? '#1A2236' : gradMap[variant],
      color: disabled ? C.muted : '#fff', border: 'none',
      padding: '14px 28px', borderRadius: 12, fontWeight: 700,
      fontSize: '.95rem', cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'all .2s ease', letterSpacing: '.3px', width: '100%', ...style
    }}>{children}</button>
  )
}

function StatusBadge({ text, type = 'info' }) {
  const map = {
    info:    { bg: 'rgba(59,130,246,.12)', border: 'rgba(59,130,246,.3)', color: '#93C5FD' },
    success: { bg: 'rgba(16,185,129,.12)', border: 'rgba(16,185,129,.3)', color: '#6EE7B7' },
    warning: { bg: 'rgba(245,158,11,.12)', border: 'rgba(245,158,11,.3)', color: '#FCD34D' },
    danger:  { bg: 'rgba(239,68,68,.12)',  border: 'rgba(239,68,68,.3)',  color: '#FCA5A5' },
    purple:  { bg: 'rgba(99,102,241,.12)', border: 'rgba(99,102,241,.3)', color: '#A5B4FC' },
  }
  const s = map[type] || map.info
  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
      borderRadius: 10, padding: '10px 16px', fontSize: '.88rem',
      fontWeight: 600, textAlign: 'center', width: '100%', maxWidth: 460,
    }}>{text}</div>
  )
}

function PlayerCard({ name, side, active, captured = [] }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: active ? 'rgba(99,102,241,.06)' : C.bg2,
      border: `1px solid ${active ? C.border2 : C.border}`,
      borderRadius: 12, padding: '10px 14px', width: '100%', maxWidth: 460,
      transition: 'all .3s ease',
      boxShadow: active ? '0 0 20px rgba(99,102,241,.1)' : 'none',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: side === 'white' ? 'linear-gradient(135deg,#F8FAFC,#CBD5E1)' : 'linear-gradient(135deg,#1E293B,#0F172A)',
        border: `1px solid ${active ? C.accent : C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0
      }}>{side === 'white' ? '♔' : '♚'}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: '.88rem', color: C.text }}>{name}</div>
        <div style={{ fontSize: 12, marginTop: 2, color: C.muted, letterSpacing: '1px' }}>{captured.join(' ')}</div>
      </div>
      {active && <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.green, animation: 'glow-pulse 1.5s infinite' }} />}
    </div>
  )
}

function MoveHistory({ moves }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [moves])
  if (!moves.length) return null
  return (
    <div ref={ref} style={{ width: '100%', maxWidth: 460, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 12px', maxHeight: 68, overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
        {Array.from({ length: Math.ceil(moves.length / 2) }, (_, i) => (
          <span key={i} style={{ fontSize: '.8rem', color: C.muted }}>
            <span style={{ color: '#374151', marginRight: 4 }}>{i + 1}.</span>
            <span style={{ color: i * 2 === moves.length - 1 ? C.accent : C.text }}>{moves[i * 2]}</span>
            {moves[i * 2 + 1] && <span style={{ color: i * 2 + 1 === moves.length - 1 ? C.accent : C.text, marginLeft: 8 }}>{moves[i * 2 + 1]}</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  useEffect(() => { injectStyles() }, [])

  const [screen, setScreen]         = useState('home')
  const [fen, setFen]               = useState('start')
  const [myTurn, setMyTurn]         = useState(false)
  const [color, setColor]           = useState(null)
  const [matchId, setMatchId]       = useState('')
  const [joinId, setJoinId]         = useState('')
  const [status, setStatus]         = useState('')
  const [statusType, setStatusType] = useState('info')
  const [result, setResult]         = useState(null)
  const [stake, setStake]           = useState('5')
  const [loading, setLoading]       = useState(false)
  const [inCheck, setInCheck]       = useState(false)
  const [moves, setMoves]           = useState([])
  const [capW, setCapW]             = useState([])
  const [capB, setCapB]             = useState([])
  
  const gameRef = useRef(new Chess())
  const wsRef   = useRef(null)

  useEffect(() => { tg?.ready(); tg?.expand() }, [])

  function setMsg(text, type = 'info') { setStatus(text); setStatusType(type) }

  async function createMatch() {
    setLoading(true); setMsg('Creating match...', 'purple')
    try {
      const res = await fetch(`${API}/api/match/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-init-data': initData },
        body: JSON.stringify({ stake: parseFloat(stake) || 5 })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed')
      setMatchId(data.match_id)
      setColor('white')
      setScreen('lobby')
      setMsg('Waiting for opponent...', 'purple')
      connectWS(data.match_id, 'white')
    } catch (e) { setMsg('❌ ' + e.message, 'danger') }
    finally { setLoading(false) }
  }

  async function joinMatch() {
    if (!joinId.trim()) { setMsg('Paste a match ID first', 'warning'); return }
    setLoading(true); setMsg('Joining...', 'blue')
    try {
      const res = await fetch(`${API}/api/match/${joinId.trim()}/join`, {
        method: 'POST', headers: { 'x-init-data': initData }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed')
      setMatchId(joinId.trim())
      setColor('black')
      setScreen('game')
      connectWS(joinId.trim(), 'black')
    } catch (e) { setMsg('❌ ' + e.message, 'danger') }
    finally { setLoading(false) }
  }

  function connectWS(mid, clr) {
    const ws = new WebSocket(`${WSS}/ws/${mid}/${clr}`)
    wsRef.current = ws
    
    ws.onopen = () => setMsg(clr === 'white' ? '⏳ Waiting for opponent...' : '⚡ Game on!', 'purple')
    
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data)
      if (msg.type === 'connected' || msg.type === 'state') {
        const g = gameRef.current
        g.load(msg.fen)
        setFen(msg.fen)
        
        const itsMine = msg.turn === clr
        setInCheck(msg.in_check && itsMine)
        setMyTurn(!msg.game_over && itsMine)
        
        if (screen !== 'game') setScreen('game')
        setMoves(g.history())
        
        // Calculate captured pieces dynamically from current game board state
        const wC = [], bC = []
        const syms = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕' }
        g.history({ verbose: true }).forEach(m => {
          if (m.captured) {
            const sym = syms[m.color === 'w' ? m.captured : m.captured.toUpperCase()] || '?'
            if (m.color === 'w') wC.push(sym); else bC.push(sym)
          }
        })
        setCapW(wC); setCapB(bC)

        if (!msg.game_over) {
          if (msg.in_check && itsMine) setMsg('⚠️ You are in Check!', 'danger')
          else if (itsMine) setMsg('⚡ Your turn!', 'success')
          else setMsg('⏳ Opponent thinking...', 'info')
        }
        if (msg.game_over && msg.result) endGame(msg.result, clr)
      }
      if (msg.type === 'gameover') endGame(msg, clr)
      if (msg.type === 'error') setMsg('⚠ ' + msg.msg, 'warning')
    }
    ws.onclose = () => { if (!result) setMsg('🔌 Disconnected', 'danger') }
    ws.onerror = () => setMsg('❌ Connection failed', 'danger')
  }

  function endGame(r, clr) {
    setMyTurn(false)
    setResult(r)
    if (!r.winner) setMsg('½ Draw — ' + (r.reason || ''), 'warning')
    else if (r.winner === clr) setMsg(`🏆 You WIN! +$${(parseFloat(stake) * 2 * 0.9).toFixed(2)} USDT`, 'success')
    else setMsg('💀 You lost. Better luck next time!', 'danger')
  }

  // FOOLPROOF ON-DROP RULE VALIDATION
  function onDrop(from, to) {
    // Rule 1: Halt instantly if it's not your turn or game has already concluded
    if (!myTurn || result) return false

    const g = gameRef.current

    // Rule 2: Verify the moving piece actually belongs to this player's color assignment
    const piece = g.get(from)
    const expectedColor = color === 'white' ? 'w' : 'b'
    if (!piece || piece.color !== expectedColor) return false

    // Rule 3: Check if the square trajectory is a valid move option
    const movesList = g.moves({ square: from, verbose: true })
    const matchedMove = movesList.find(m => m.to === to)
    if (!matchedMove) return false

    // Rule 4: Handle standard pawn auto-promotion to Queen
    const promo = matchedMove.flags.includes('p') ? 'q' : undefined

    // Rule 5: Commit the move locally to prevent UI lag/snapback
    if (!g.move({ from, to, promotion: promo })) return false
    
    setFen(g.fen())
    setMyTurn(false)
    setMoves(g.history())
    setMsg('⏳ Opponent thinking...', 'info')

    // Rule 6: Dispatch verified coordinates to backend transaction socket
    wsRef.current?.send(JSON.stringify({ type: 'move', move: from + to + (promo || '') }))
    return true
  }

  function reset() {
    wsRef.current?.close()
    gameRef.current = new Chess()
    setScreen('home'); setFen('start'); setMyTurn(false); setColor(null)
    setResult(null); setMatchId(''); setJoinId(''); setStatus('')
    setInCheck(false); setMoves([]); setCapW([]); setCapB([])
  }

  const pool = parseFloat(stake || 0) * 2
  const winAmt = pool * 0.9
  const fee = pool * 0.1

  // SCREEN — HOME
  if (screen === 'home') return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 14px 40px', gap: 16 }}>
      <div className="slide-up" style={{ textAlign: 'center', marginBottom: 4 }}>
        <div className="float" style={{ fontSize: 56, marginBottom: 6 }}>♟</div>
        <h1 style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: '-1px', background: 'linear-gradient(135deg,#A5B4FC,#6366F1,#8B5CF6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          CHESS ARENA
        </h1>
        <p style={{ color: C.muted, fontSize: '.78rem', marginTop: 4, letterSpacing: '2px', textTransform: 'uppercase' }}>Real-money · Premium</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 50, padding: '8px 16px' }}>
        <div style={{ width: 24, height: 24, borderRadius: '50%', background: grad.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>
          {(tgUser.username || 'P')[0].toUpperCase()}
        </div>
        <span style={{ fontWeight: 600, fontSize: '.85rem' }}>@{tgUser.username || 'Player'}</span>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}` }} />
      </div>

      <GlowCard style={{ width: '100%', maxWidth: 420 }} className="slide-up">
        <p style={{ fontSize: '.72rem', fontWeight: 700, color: C.muted, letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 12 }}>💰 Set Your Stake</p>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {['1', '5', '10', '25', '50'].map(v => (
            <button key={v} onClick={() => setStake(v)} style={{
              flex: 1, padding: '10px 4px', borderRadius: 8,
              border: `1px solid ${stake === v ? C.accent : C.border}`,
              background: stake === v ? 'rgba(99,102,241,.15)' : 'transparent',
              color: stake === v ? '#A5B4FC' : C.muted,
              fontWeight: 700, fontSize: '.85rem', cursor: 'pointer', transition: 'all .2s',
            }}>${v}</button>
          ))}
        </div>
        <input type="number" value={stake} onChange={e => setStake(e.target.value)} placeholder="Custom amount..."
          style={{ width: '100%', background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 14px', color: C.text, fontSize: '1rem', fontWeight: 600, marginBottom: 14 }} />
        
        <div style={{ background: C.bg3, borderRadius: 10, padding: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
          {[{ label: 'Prize Pool', value: `$${pool.toFixed(2)}`, color: '#A5B4FC' },
            { label: 'Winner Gets', value: `$${winAmt.toFixed(2)}`, color: C.green },
            { label: 'Platform Fee', value: `$${fee.toFixed(2)}`, color: C.muted }].map(({ label, value, color }) => (
            <div key={label}>
              <div style={{ fontSize: '.7rem', color: C.muted, marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: '.95rem', fontWeight: 800, color }}>{value}</div>
            </div>
          ))}
        </div>
      </GlowCard>

      <PrimaryBtn onClick={createMatch} disabled={loading} variant="accent" style={{ maxWidth: 420 }}>
        {loading ? '⏳ Creating...' : '⚔️ Create New Match'}
      </PrimaryBtn>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', maxWidth: 420, margin: '4px 0' }}>
        <div style={{ flex: 1, height: 1, background: C.border }} />
        <span style={{ color: C.muted, fontSize: '.75rem', fontWeight: 600, letterSpacing: '1px' }}>OR JOIN MATCH</span>
        <div style={{ flex: 1, height: 1, background: C.border }} />
      </div>

      <GlowCard style={{ width: '100%', maxWidth: 420 }} className="slide-up">
        <input value={joinId} onChange={e => setJoinId(e.target.value)} placeholder="Paste match ID here..."
          style={{ width: '100%', background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', color: C.text, fontSize: '.95rem', marginBottom: 12 }} />
        <PrimaryBtn onClick={joinMatch} disabled={loading || !joinId.trim()} variant="blue">
          {loading ? '⏳ Joining...' : '🚀 Join Match ID'}
        </PrimaryBtn>
      </GlowCard>

      {status && <StatusBadge text={status} type={statusType} />}
    </div>
  )

  // SCREEN — LOBBY
  if (screen === 'lobby') return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 14px', gap: 20 }}>
      <div style={{ fontSize: 52, animation: 'float 3s infinite' }}>⚔️</div>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontWeight: 800, color: '#A5B4FC', fontSize: '1.5rem' }}>Match Generated!</h2>
        <p style={{ color: C.muted, fontSize: '.88rem', marginTop: 4 }}>Pass this code to your opponent to begin</p>
      </div>

      <GlowCard style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
        <div style={{ background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px', fontFamily: 'monospace', fontSize: '.85rem', wordBreak: 'break-all', color: '#A5B4FC', marginBottom: 12, letterSpacing: '.5px' }}>
          {matchId}
        </div>
        <PrimaryBtn onClick={() => { navigator.clipboard.writeText(matchId); setMsg('✅ Copied to clipboard!', 'success') }} variant="blue">
          📋 Copy Match ID
        </PrimaryBtn>
      </GlowCard>

      {status && <StatusBadge text={status} type={statusType} />}

      <button onClick={reset} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, padding: '10px 24px', borderRadius: 10, cursor: 'pointer', fontWeight: 600, fontSize: '.85rem', transition: 'all .2s' }}>
        ← Cancel Match
      </button>
    </div>
  )

  // SCREEN — ACTIVE GAME
  const whiteActive = !result && gameRef.current.turn() === 'w'
  const blackActive = !result && gameRef.current.turn() === 'b'

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 10px 32px', gap: 12 }}>
      {status && <StatusBadge text={status} type={statusType} />}

      <PlayerCard name={color === 'black' ? 'Opponent' : `@${tgUser.username}`} side="white" active={whiteActive} captured={capW} />

      <div style={{ 
        width: 'min(460px, calc(100vw - 16px))', borderRadius: 16, overflow: 'hidden', 
        boxShadow: inCheck ? `0 0 0 3px ${C.red}, 0 20px 50px rgba(239,68,68,.2)` : `0 0 0 1px ${C.border}, 0 20px 50px rgba(0,0,0,.5)`,
        transition: 'box-shadow .3s ease' 
      }}>
        <Chessboard
          id="arena-board"
          position={fen}
          onPieceDrop={onDrop}
          boardOrientation={color === 'black' ? 'black' : 'white'}
          arePiecesDraggable={myTurn && !result}
          animationDuration={180}
          customBoardStyle={{ borderRadius: 0 }}
          customDarkSquareStyle={{ backgroundColor: '#B06000' }}
          customLightSquareStyle={{ backgroundColor: '#F0C070' }}
        />
      </div>

      <PlayerCard name={color === 'black' ? `@${tgUser.username}` : 'Opponent'} side="black" active={blackActive} captured={capB} />
      
      <MoveHistory moves={moves} />

      <div style={{ width: '100%', maxWidth: 460, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '.72rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '1px' }}>Escrow Pool</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: C.green, marginTop: 2 }}>${pool.toFixed(2)} USDT</div>
        </div>
        <div style={{ width: 1, height: 32, background: C.border }} />
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '.72rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '1px' }}>Playing As</div>
          <div style={{ fontSize: '.95rem', fontWeight: 700, color: '#A5B4FC', marginTop: 2, textTransform: 'capitalize' }}>{color} (${stake})</div>
        </div>
      </div>

      {result && (
        <PrimaryBtn onClick={reset} variant="accent" style={{ maxWidth: 460, marginTop: 4 }}>
          🔄 Play Another Match
        </PrimaryBtn>
      )}
    </div>
  )
}