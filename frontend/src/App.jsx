import { useState, useEffect, useRef } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'

const API = 'https://chess-bot-production-efa2.up.railway.app'
const WSS = 'wss://chess-bot-production-efa2.up.railway.app'

const tg = window.Telegram?.WebApp
const tgUser = tg?.initDataUnsafe?.user || { id: 0, username: 'Player' }

export default function App() {
  const [screen, setScreen]   = useState('home')
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
  const [status, setStatus]   = useState('')
  const [color, setColor]     = useState(null)
  const [matchId, setMatchId] = useState('')
  const [joinId, setJoinId]   = useState('')
  const [result, setResult]   = useState(null)
  const [stake, setStake]     = useState(5)
  const [loading, setLoading] = useState(false)
  const [myTurnUI, setMyTurnUI] = useState(false)

  const chessRef    = useRef(new Chess('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'))
  const wsRef       = useRef(null)
  const colorRef    = useRef(null)
  const waitingRef  = useRef(false)

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
      colorRef.current = 'white'
      setColor('white')
      setScreen('lobby')
      connect(data.match_id, 'white')
    } catch (e) {
      setStatus('Error: ' + e.message)
    }
    setLoading(false)
  }

  async function joinMatch() {
    if (!joinId.trim()) { setStatus('Enter match ID'); return }
    setLoading(true)
    try {
      const res = await fetch(API + '/api/match/' + joinId.trim() + '/join', {
        method: 'POST',
        headers: { 'x-init-data': 'test' }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(data))
      colorRef.current = 'black'
      setColor('black')
      setScreen('game')
      connect(joinId.trim(), 'black')
    } catch (e) {
      setStatus('Error: ' + e.message)
    }
    setLoading(false)
  }

  function connect(mid, clr) {
    const sock = new WebSocket(WSS + '/ws/' + mid + '/' + clr)
    wsRef.current = sock

    sock.onopen = () => {
      setStatus(clr === 'white' ? '⏳ Waiting for opponent...' : '⚡ Game on!')
    }

    sock.onmessage = (evt) => {
      const msg = JSON.parse(evt.data)
      const myClr = colorRef.current

      if (msg.type === 'connected') {
        const game = new Chess(msg.fen)
        chessRef.current = game
        setFen(msg.fen)
        setScreen('game')
        const mine = msg.turn === colorRef.current
        setMyTurnUI(mine)
        setStatus(mine ? '⚡ Your turn!' : '⏳ Waiting for opponent...')
        waitingRef.current = false
      }

      if (msg.type === 'state') {
        if (waitingRef.current) {
          // This is the server confirming OUR move
          // Board is already correct locally — just update turn
          waitingRef.current = false
          const mine = msg.turn === colorRef.current
          setMyTurnUI(mine)
          if (msg.game_over && msg.result) {
            endGame(msg.result, colorRef.current)
          } else {
            setStatus(mine ? '⚡ Your turn!' : '⏳ Opponent thinking...')
          }
        } else {
          // Opponent moved — update board from server
          const game = new Chess(msg.fen)
          chessRef.current = game
          setFen(msg.fen)
          const mine = msg.turn === colorRef.current
          setMyTurnUI(mine)
          if (msg.game_over && msg.result) {
            endGame(msg.result, colorRef.current)
          } else {
            setStatus(mine ? '⚡ Your turn!' : '⏳ Opponent thinking...')
          }
        }
      }

      if (msg.type === 'gameover') {
        endGame(msg, colorRef.current)
      }
    }

    sock.onclose = () => setStatus('🔌 Disconnected')
    sock.onerror = () => setStatus('❌ Connection error')
  }

  function endGame(r, clr) {
    setMyTurnUI(false)
    setResult(r)
    if (!r.winner) setStatus('½ Draw!')
    else if (r.winner === clr) setStatus('🏆 YOU WIN! +$' + (stake * 2 * 0.9).toFixed(2) + ' USDT')
    else setStatus('💀 You lost.')
  }

  // THIS IS THE KEY FUNCTION — no myTurn check, just chess.js validation
  function onDrop(from, to) {
    // If it's not your turn, or the game is over, don't allow the drop
    if (!myTurn || result) return false

    // 1. Create a fresh instance from the EXACT current visual state
    // This forces the logic engine to perfectly match the screen
    const g = new Chess(fen)

    // 2. Try the move locally first
    let move = null
    try {
      move = g.move({ from, to, promotion: 'q' })
    } catch (e) {
      return false // The engine threw an error (illegal move)
    }

    // 3. If the move is invalid, snap the piece back
    if (!move) return false

    // 4. Move is VALID! Update the UI instantly so the piece STICKS
    setFen(g.fen())
    setMyTurn(false)
    setMoves(g.history())
    setMsg('⏳ Opponent thinking...', 'info')

    // 5. Send the move to the server
    wsRef.current?.send(JSON.stringify({ 
      type: 'move', 
      move: from + to + (move.promotion || '') 
    }))

    // 6. Update the ref for the next turn
    gameRef.current = g

    return true // Tells the board: "Yes, keep the piece here!"
  } 

    // Send to server
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'move',
        move: from + to + (move.promotion || '')
      }))
    }

    return true
  }

  function reset() {
    if (wsRef.current) wsRef.current.close()
    chessRef.current = new Chess()
    wsRef.current = null
    colorRef.current = null
    waitingRef.current = false
    setScreen('home')
    setFen('start')
    setMyTurnUI(false)
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
    page: {
      minHeight: '100vh', background: '#080B14', color: '#eaeaea',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '20px 12px', gap: '14px', fontFamily: 'sans-serif'
    },
    box: {
      background: '#111827', border: '1px solid rgba(255,255,255,.08)',
      borderRadius: '12px', padding: '16px', width: '100%', maxWidth: '440px'
    },
    btn: (bg, dis) => ({
      background: dis ? '#1f2937' : bg, color: dis ? '#4b5563' : '#fff',
      border: 'none', padding: '13px', borderRadius: '10px',
      fontWeight: '700', fontSize: '1rem',
      cursor: dis ? 'not-allowed' : 'pointer',
      width: '100%', transition: 'all .2s'
    }),
    sBtn: (active) => ({
      flex: 1, padding: '9px 2px', borderRadius: '8px',
      border: active ? '2px solid #6366F1' : '1px solid #1f2937',
      background: active ? 'rgba(99,102,241,.2)' : 'transparent',
      color: active ? '#A5B4FC' : '#6B7280',
      fontWeight: '700', fontSize: '.85rem', cursor: 'pointer'
    })
  }

  // HOME
  if (screen === 'home') return (
    <div style={S.page}>
      <div style={{ fontSize: 52 }}>♟</div>
      <h1 style={{ fontSize: '1.9rem', fontWeight: 900, color: '#818CF8', letterSpacing: '-1px' }}>
        CHESS ARENA
      </h1>
      <p style={{ color: '#6B7280', fontSize: '.8rem' }}>@{tgUser.username || 'Player'}</p>

      <div style={S.box}>
        <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: '10px' }}>
          SET STAKE (USDT)
        </p>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
          {[1, 5, 10, 25, 50].map(v => (
            <button key={v} onClick={() => setStake(v)} style={S.sBtn(stake === v)}>${v}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', textAlign: 'center', background: '#1a2236', borderRadius: '8px', padding: '12px' }}>
          <div>
            <div style={{ color: '#6B7280', fontSize: '.7rem', marginBottom: 3 }}>Pool</div>
            <div style={{ color: '#A5B4FC', fontWeight: 800 }}>${pool.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ color: '#6B7280', fontSize: '.7rem', marginBottom: 3 }}>You Win</div>
            <div style={{ color: '#10B981', fontWeight: 800 }}>${win.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ color: '#6B7280', fontSize: '.7rem', marginBottom: 3 }}>Fee</div>
            <div style={{ color: '#6B7280', fontWeight: 800 }}>${fee.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <button onClick={createMatch} disabled={loading}
        style={S.btn('linear-gradient(135deg,#6366F1,#8B5CF6)', loading)}>
        {loading ? 'Creating...' : '⚔️ Create New Match'}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', maxWidth: 440 }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.06)' }} />
        <span style={{ color: '#4B5563', fontSize: '.78rem', fontWeight: 600 }}>OR JOIN</span>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.06)' }} />
      </div>

      <div style={S.box}>
        <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: '10px' }}>
          JOIN WITH MATCH ID
        </p>
        <input value={joinId} onChange={e => setJoinId(e.target.value)}
          placeholder="Paste match ID here..."
          style={{ width: '100%', background: '#0f1f3d', border: '1px solid #1a3a5c', borderRadius: '8px', padding: '11px', color: '#eaeaea', fontSize: '.9rem', marginBottom: '10px' }} />
        <button onClick={joinMatch} disabled={loading || !joinId.trim()}
          style={S.btn('linear-gradient(135deg,#3B82F6,#6366F1)', loading || !joinId.trim())}>
          {loading ? 'Joining...' : '🚀 Join Match'}
        </button>
      </div>

      {status && (
        <div style={{ background: 'rgba(99,102,241,.1)', border: '1px solid rgba(99,102,241,.3)', borderRadius: '8px', padding: '10px 16px', color: '#A5B4FC', fontSize: '.85rem', textAlign: 'center', width: '100%', maxWidth: 440 }}>
          {status}
        </div>
      )}
    </div>
  )

  // LOBBY
  if (screen === 'lobby') return (
    <div style={S.page}>
      <div style={{ fontSize: 52 }}>⚔️</div>
      <h2 style={{ fontWeight: 800, color: '#818CF8', fontSize: '1.4rem' }}>Match Created!</h2>
      <p style={{ color: '#6B7280', fontSize: '.85rem' }}>Share this ID with your opponent</p>

      <div style={{ ...S.box, textAlign: 'center' }}>
        <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: 10 }}>MATCH ID</p>
        <div style={{ background: '#0f1f3d', border: '1px solid #1a3a5c', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: '.8rem', wordBreak: 'break-all', color: '#A5B4FC', marginBottom: 12 }}>
          {matchId}
        </div>
        <button onClick={() => { navigator.clipboard.writeText(matchId); setStatus('✅ Copied!') }}
          style={S.btn('linear-gradient(135deg,#3B82F6,#6366F1)', false)}>
          📋 Copy Match ID
        </button>
      </div>

      <div style={{ color: '#6B7280', fontSize: '.85rem' }}>⏳ Waiting for opponent...</div>
      {status && <div style={{ color: '#10B981', fontSize: '.85rem' }}>{status}</div>}
      <button onClick={reset} style={{ background: 'transparent', border: '1px solid #1f2937', color: '#6B7280', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer', fontSize: '.85rem' }}>← Cancel</button>
    </div>
  )

  // GAME
  return (
    <div style={{ ...S.page, padding: '10px 10px 28px', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: 460 }}>
        <div>
          <div style={{ fontWeight: 800, color: '#818CF8', fontSize: '.9rem' }}>♟ CHESS ARENA</div>
          <div style={{ color: '#6B7280', fontSize: '.72rem' }}>
            You are <strong style={{ color: '#A5B4FC' }}>{color}</strong> · ${stake} stake
          </div>
        </div>
        <div style={{
          background: myTurnUI ? 'rgba(16,185,129,.1)' : 'rgba(99,102,241,.1)',
          border: `1px solid ${myTurnUI ? 'rgba(16,185,129,.3)' : 'rgba(99,102,241,.3)'}`,
          borderRadius: 8, padding: '5px 10px', fontSize: '.75rem', fontWeight: 700,
          color: myTurnUI ? '#10B981' : '#A5B4FC'
        }}>
          {myTurnUI ? '⚡ Your turn' : '⏳ Waiting'}
        </div>
      </div>

      <div style={{
        background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)',
        borderRadius: 10, padding: '10px 16px', fontSize: '.88rem', fontWeight: 600,
        textAlign: 'center', width: '100%', maxWidth: 460, color: '#A5B4FC'
      }}>
        {status || '♟ Game in progress'}
      </div>

      <div style={{ width: 'min(460px, calc(100vw - 16px))', borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,.6)' }}>
        <Chessboard
          id="chess-board"
          position={fen}
          onPieceDrop={onDrop}
          boardOrientation={color === 'black' ? 'black' : 'white'}
          arePiecesDraggable={!result}
          animationDuration={200}
          customBoardStyle={{ borderRadius: 0 }}
          customDarkSquareStyle={{ backgroundColor: '#B45309' }}
          customLightSquareStyle={{ backgroundColor: '#FCD34D' }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: 460, background: '#111827', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12, padding: '10px 16px' }}>
        <div>
          <div style={{ color: '#6B7280', fontSize: '.7rem' }}>Prize Pool</div>
          <div style={{ color: '#10B981', fontWeight: 800 }}>${pool.toFixed(2)} USDT</div>
        </div>
        <div style={{ width: 1, background: 'rgba(255,255,255,.06)' }} />
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#6B7280', fontSize: '.7rem' }}>Winner Gets</div>
          <div style={{ color: '#A5B4FC', fontWeight: 800 }}>${win.toFixed(2)} USDT</div>
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
