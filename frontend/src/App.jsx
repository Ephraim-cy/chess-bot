import { useState, useEffect, useRef, useCallback } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'

const API = 'https://chess-bot-production-efa2.up.railway.app'
const WSS = 'wss://chess-bot-production-efa2.up.railway.app'

const tg = window.Telegram?.WebApp
const tgUser = tg?.initDataUnsafe?.user || { id: 0, username: 'Player' }

export default function App() {
  const [screen, setScreen]       = useState('home')
  const [fen, setFen]             = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
  const [myTurn, setMyTurn]       = useState(false)
  const [color, setColor]         = useState(null)
  const [matchId, setMatchId]     = useState('')
  const [joinId, setJoinId]       = useState('')
  const [status, setStatus]       = useState('')
  const [result, setResult]       = useState(null)
  const [stake, setStake]         = useState(5)
  const [loading, setLoading]     = useState(false)

  // Use refs for chess game and websocket
  const chess   = useRef(new Chess())
  const ws      = useRef(null)
  const myColor = useRef(null)
  const justMoved = useRef(false)

  useEffect(() => { tg?.ready(); tg?.expand() }, [])

  async function createMatch() {
    setLoading(true)
    setStatus('Creating...')
    try {
      const res = await fetch(API + '/api/match/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-init-data': 'test' },
        body: JSON.stringify({ stake })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(data))
      setMatchId(data.match_id)
      setColor('white')
      myColor.current = 'white'
      setScreen('lobby')
      openWS(data.match_id, 'white')
    } catch (e) {
      setStatus('Error: ' + e.message)
    }
    setLoading(false)
  }

  async function joinMatch() {
    if (!joinId.trim()) { setStatus('Enter match ID'); return }
    setLoading(true)
    setStatus('Joining...')
    try {
      const res = await fetch(API + '/api/match/' + joinId.trim() + '/join', {
        method: 'POST',
        headers: { 'x-init-data': 'test' }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(data))
      setColor('black')
      myColor.current = 'black'
      setScreen('game')
      openWS(joinId.trim(), 'black')
    } catch (e) {
      setStatus('Error: ' + e.message)
    }
    setLoading(false)
  }

  function openWS(mid, clr) {
    const sock = new WebSocket(WSS + '/ws/' + mid + '/' + clr)
    ws.current = sock

    sock.onopen = () => {
      setStatus(clr === 'white' ? 'Waiting for opponent...' : 'Game started! Your turn is Black.')
      if (clr === 'black') setMyTurn(true)
    }

    sock.onmessage = (evt) => {
      const msg = JSON.parse(evt.data)

      if (msg.type === 'connected') {
        // Initial board state from server
        chess.current = new Chess(msg.fen)
        setFen(msg.fen)
        const isMine = msg.turn === clr
        setMyTurn(isMine)
        setScreen('game')
        setStatus(isMine ? 'Your turn!' : 'Waiting for opponent...')
      }

      if (msg.type === 'state') {
        if (justMoved.current) {
          // We just moved — server confirmed it
          // Only update turn indicator, NOT the board position
          justMoved.current = false
          const isMine = msg.turn === clr
          setMyTurn(isMine)
          if (msg.game_over && msg.result) {
            handleEnd(msg.result, clr)
          } else {
            setStatus(isMine ? 'Your turn!' : 'Opponent thinking...')
          }
        } else {
          // Opponent moved — update board with server state
          chess.current = new Chess(msg.fen)
          setFen(msg.fen)
          const isMine = msg.turn === clr
          setMyTurn(isMine)
          if (msg.game_over && msg.result) {
            handleEnd(msg.result, clr)
          } else {
            setStatus(isMine ? 'Your turn!' : 'Opponent thinking...')
          }
        }
      }

      if (msg.type === 'gameover') handleEnd(msg, clr)
      if (msg.type === 'error') {
        // Server rejected our move — revert
        justMoved.current = false
        setStatus('Invalid move!')
      }
    }

    sock.onclose = () => {
      if (!result) setStatus('Disconnected. Refresh to reconnect.')
    }
    sock.onerror = () => setStatus('Connection error')
  }

  function handleEnd(r, clr) {
    setMyTurn(false)
    setResult(r)
    if (!r.winner) setStatus('Draw!')
    else if (r.winner === clr) setStatus('YOU WIN! +$' + (stake * 2 * 0.9).toFixed(2) + ' USDT')
    else setStatus('You lost.')
  }

  const onDrop = useCallback((from, to) => {
    // Only allow if it's our turn
    if (!myTurn || result) return false

    // Try move locally first
    const gameCopy = new Chess(chess.current.fen())
    let move
    try {
      move = gameCopy.move({ from, to, promotion: 'q' })
    } catch (e) {
      return false
    }
    if (!move) return false

    // Move is valid — update local state immediately
    chess.current = gameCopy
    const newFen = gameCopy.fen()
    setFen(newFen)
    setMyTurn(false)
    setStatus('Opponent thinking...')
    justMoved.current = true

    // Send to server
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'move',
        move: from + to + (move.promotion || '')
      }))
    } else {
      // Not connected — revert
      justMoved.current = false
      chess.current = new Chess(fen)
      setFen(fen)
      setMyTurn(true)
      setStatus('Not connected to server!')
      return false
    }

    return true
  }, [myTurn, result, fen])

  function reset() {
    if (ws.current) ws.current.close()
    chess.current = new Chess()
    ws.current = null
    myColor.current = null
    justMoved.current = false
    setScreen('home')
    setFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    setMyTurn(false)
    setColor(null)
    setResult(null)
    setMatchId('')
    setJoinId('')
    setStatus('')
    setLoading(false)
  }

  const pool = stake * 2
  const win  = pool * 0.9
  const fee  = pool * 0.1

  const S = {
    page: { minHeight:'100vh', background:'#080B14', color:'#eaeaea', display:'flex', flexDirection:'column', alignItems:'center', padding:'20px 12px', gap:'14px', fontFamily:'Inter,sans-serif' },
    box:  { background:'#111827', border:'1px solid rgba(255,255,255,.08)', borderRadius:'12px', padding:'16px', width:'100%', maxWidth:'440px' },
    btn:  (bg, dis) => ({ background: dis?'#1f2937':bg, color: dis?'#4b5563':'#fff', border:'none', padding:'13px', borderRadius:'10px', fontWeight:'700', fontSize:'1rem', cursor: dis?'not-allowed':'pointer', width:'100%', transition:'all .2s' }),
    stakeBtn: (active) => ({ flex:1, padding:'9px 2px', borderRadius:'8px', border: active?'2px solid #6366F1':'1px solid #1f2937', background: active?'rgba(99,102,241,.2)':'transparent', color: active?'#A5B4FC':'#6B7280', fontWeight:'700', fontSize:'.85rem', cursor:'pointer', transition:'all .2s' }),
  }

  // ── HOME ────────────────────────────────────────────────────────────────────
  if (screen === 'home') return (
    <div style={S.page}>
      <div style={{ fontSize:52, marginBottom:'-4px' }}>♟</div>
      <h1 style={{ fontSize:'1.9rem', fontWeight:900, background:'linear-gradient(135deg,#818CF8,#6366F1)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', letterSpacing:'-1px' }}>
        CHESS ARENA
      </h1>
      <p style={{ color:'#6B7280', fontSize:'.8rem' }}>@{tgUser.username || 'Player'}</p>

      <div style={S.box}>
        <p style={{ color:'#6B7280', fontSize:'.72rem', fontWeight:700, letterSpacing:'1px', marginBottom:'10px' }}>SET STAKE (USDT)</p>
        <div style={{ display:'flex', gap:'6px', marginBottom:'12px' }}>
          {[1,5,10,25,50].map(v => (
            <button key={v} onClick={() => setStake(v)} style={S.stakeBtn(stake===v)}>${v}</button>
          ))}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', textAlign:'center', background:'#1a2236', borderRadius:'8px', padding:'12px', gap:'4px' }}>
          <div><div style={{ color:'#6B7280', fontSize:'.7rem', marginBottom:'3px' }}>Pool</div><div style={{ color:'#A5B4FC', fontWeight:800 }}>${pool.toFixed(2)}</div></div>
          <div><div style={{ color:'#6B7280', fontSize:'.7rem', marginBottom:'3px' }}>You Win</div><div style={{ color:'#10B981', fontWeight:800 }}>${win.toFixed(2)}</div></div>
          <div><div style={{ color:'#6B7280', fontSize:'.7rem', marginBottom:'3px' }}>Fee 10%</div><div style={{ color:'#6B7280', fontWeight:800 }}>${fee.toFixed(2)}</div></div>
        </div>
      </div>

      <button onClick={createMatch} disabled={loading} style={S.btn('linear-gradient(135deg,#6366F1,#8B5CF6)', loading)}>
        {loading ? 'Creating...' : '⚔️ Create New Match'}
      </button>

      <div style={{ display:'flex', alignItems:'center', gap:10, width:'100%', maxWidth:440 }}>
        <div style={{ flex:1, height:1, background:'rgba(255,255,255,.06)' }}/>
        <span style={{ color:'#4B5563', fontSize:'.78rem', fontWeight:600 }}>OR JOIN</span>
        <div style={{ flex:1, height:1, background:'rgba(255,255,255,.06)' }}/>
      </div>

      <div style={S.box}>
        <p style={{ color:'#6B7280', fontSize:'.72rem', fontWeight:700, letterSpacing:'1px', marginBottom:'10px' }}>JOIN WITH MATCH ID</p>
        <input value={joinId} onChange={e => setJoinId(e.target.value)} placeholder="Paste match ID here..."
          style={{ width:'100%', background:'#0f1f3d', border:'1px solid #1a3a5c', borderRadius:'8px', padding:'11px', color:'#eaeaea', fontSize:'.9rem', marginBottom:'10px' }}/>
        <button onClick={joinMatch} disabled={loading || !joinId.trim()} style={S.btn('linear-gradient(135deg,#3B82F6,#6366F1)', loading || !joinId.trim())}>
          {loading ? 'Joining...' : '🚀 Join Match'}
        </button>
      </div>

      {status && (
        <div style={{ background:'rgba(99,102,241,.1)', border:'1px solid rgba(99,102,241,.3)', borderRadius:'8px', padding:'10px 16px', color:'#A5B4FC', fontSize:'.85rem', textAlign:'center', width:'100%', maxWidth:440 }}>
          {status}
        </div>
      )}
    </div>
  )

  // ── LOBBY ───────────────────────────────────────────────────────────────────
  if (screen === 'lobby') return (
    <div style={S.page}>
      <div style={{ fontSize:52 }}>⚔️</div>
      <h2 style={{ fontWeight:800, color:'#818CF8', fontSize:'1.4rem' }}>Match Created!</h2>
      <p style={{ color:'#6B7280', fontSize:'.85rem', textAlign:'center' }}>Share this ID with your opponent</p>

      <div style={S.box}>
        <p style={{ color:'#6B7280', fontSize:'.72rem', fontWeight:700, letterSpacing:'1px', marginBottom:'10px', textAlign:'center' }}>MATCH ID</p>
        <div style={{ background:'#0f1f3d', border:'1px solid #1a3a5c', borderRadius:'8px', padding:'12px', fontFamily:'monospace', fontSize:'.8rem', wordBreak:'break-all', color:'#A5B4FC', marginBottom:'12px', textAlign:'center' }}>
          {matchId}
        </div>
        <button onClick={() => { navigator.clipboard.writeText(matchId); setStatus('Copied!') }}
          style={S.btn('linear-gradient(135deg,#3B82F6,#6366F1)', false)}>
          📋 Copy Match ID
        </button>
      </div>

      <div style={{ display:'flex', gap:8, width:'100%', maxWidth:440 }}>
        <div style={{ ...S.box, textAlign:'center', flex:1 }}>
          <div style={{ color:'#6B7280', fontSize:'.7rem' }}>Stake</div>
          <div style={{ color:'#A5B4FC', fontWeight:800, fontSize:'1.1rem' }}>${stake}</div>
        </div>
        <div style={{ ...S.box, textAlign:'center', flex:1 }}>
          <div style={{ color:'#6B7280', fontSize:'.7rem' }}>Winner Gets</div>
          <div style={{ color:'#10B981', fontWeight:800, fontSize:'1.1rem' }}>${win.toFixed(2)}</div>
        </div>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:10, color:'#6B7280', fontSize:'.85rem' }}>
        <div style={{ width:14, height:14, border:'2px solid #6366F1', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 1s linear infinite' }}/>
        Waiting for opponent...
      </div>

      {status && <div style={{ color:'#10B981', fontSize:'.85rem' }}>{status}</div>}
      <button onClick={reset} style={{ background:'transparent', border:'1px solid #1f2937', color:'#6B7280', padding:'10px 24px', borderRadius:'8px', cursor:'pointer', fontSize:'.85rem' }}>← Cancel</button>

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )

  // ── GAME ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ ...S.page, padding:'10px 10px 28px', gap:10 }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', width:'100%', maxWidth:460 }}>
        <div>
          <div style={{ fontWeight:800, color:'#818CF8', fontSize:'.9rem' }}>♟ CHESS ARENA</div>
          <div style={{ color:'#6B7280', fontSize:'.72rem' }}>
            You are <strong style={{ color:'#A5B4FC' }}>{color}</strong> · ${stake} stake
          </div>
        </div>
        <div style={{
          background: myTurn ? 'rgba(16,185,129,.1)' : 'rgba(99,102,241,.1)',
          border: `1px solid ${myTurn ? 'rgba(16,185,129,.3)' : 'rgba(99,102,241,.3)'}`,
          borderRadius:8, padding:'5px 10px', fontSize:'.75rem', fontWeight:700,
          color: myTurn ? '#10B981' : '#A5B4FC'
        }}>
          {myTurn ? '⚡ Your turn' : '⏳ Waiting'}
        </div>
      </div>

      {/* Status */}
      <div style={{
        background: result ? (result.winner === color ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)') : 'rgba(99,102,241,.08)',
        border: `1px solid ${result ? (result.winner === color ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)') : 'rgba(99,102,241,.2)'}`,
        borderRadius:10, padding:'10px 16px', fontSize:'.88rem', fontWeight:600,
        textAlign:'center', width:'100%', maxWidth:460,
        color: result ? (result.winner === color ? '#10B981' : '#EF4444') : '#A5B4FC'
      }}>
        {status || '♟ Game in progress'}
      </div>

      {/* Board */}
      <div style={{ width:'min(460px,calc(100vw - 16px))', borderRadius:8, overflow:'hidden', boxShadow:'0 8px 32px rgba(0,0,0,.6)' }}>
        <Chessboard
          id="MainBoard"
          position={fen}
          onPieceDrop={onDrop}
          boardOrientation={color === 'black' ? 'black' : 'white'}
          arePiecesDraggable={!result}
          animationDuration={150}
          customBoardStyle={{ borderRadius:0 }}
          customDarkSquareStyle={{ backgroundColor:'#B45309' }}
          customLightSquareStyle={{ backgroundColor:'#FCD34D' }}
        />
      </div>

      {/* Prize bar */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', width:'100%', maxWidth:460, background:'#111827', border:'1px solid rgba(255,255,255,.06)', borderRadius:12, padding:'10px 16px' }}>
        <div>
          <div style={{ color:'#6B7280', fontSize:'.7rem' }}>Prize Pool</div>
          <div style={{ color:'#10B981', fontWeight:800, fontSize:'1rem' }}>${pool.toFixed(2)} USDT</div>
        </div>
        <div style={{ width:1, height:32, background:'rgba(255,255,255,.06)' }}/>
        <div style={{ textAlign:'right' }}>
          <div style={{ color:'#6B7280', fontSize:'.7rem' }}>Winner Gets</div>
          <div style={{ color:'#A5B4FC', fontWeight:800, fontSize:'1rem' }}>${win.toFixed(2)} USDT</div>
        </div>
      </div>

      {result && (
        <button onClick={reset} style={S.btn('linear-gradient(135deg,#6366F1,#8B5CF6)', false)}>
          🔄 Play Again
        </button>
      )}
    </div>
  )
}
