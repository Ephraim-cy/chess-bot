import { useState, useEffect, useRef } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'

const API = 'https://chess-bot-production-efa2.up.railway.app'
const WSS = 'wss://chess-bot-production-efa2.up.railway.app'

const tg = window.Telegram?.WebApp
const tgUser = tg?.initDataUnsafe?.user || { id: 0, username: 'Player' }

export default function App() {
  const [screen, setScreen] = useState('home')
  const [fen, setFen] = useState('start')
  const [myTurn, setMyTurn] = useState(false)
  const [color, setColor] = useState(null)
  const [matchId, setMatchId] = useState('')
  const [joinId, setJoinId] = useState('')
  const [status, setStatus] = useState('')
  const [result, setResult] = useState(null)
  const [stake, setStake] = useState(5)
  const [loading, setLoading] = useState(false)
  const gameRef = useRef(new Chess())
  const wsRef = useRef(null)

  useEffect(() => {
    tg?.ready()
    tg?.expand()
  }, [])

  async function createMatch() {
    setLoading(true)
    setStatus('Creating match...')
    try {
      const res = await fetch(API + '/api/match/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-init-data': 'test' },
        body: JSON.stringify({ stake: stake })
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus('Error: ' + JSON.stringify(data))
        return
      }
      setMatchId(data.match_id)
      setColor('white')
      setScreen('lobby')
      connectWS(data.match_id, 'white')
    } catch (e) {
      setStatus('Failed: ' + e.message)
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
      if (!res.ok) {
        setStatus('Error: ' + JSON.stringify(data))
        return
      }
      setColor('black')
      setScreen('game')
      connectWS(joinId.trim(), 'black')
    } catch (e) {
      setStatus('Failed: ' + e.message)
    }
    setLoading(false)
  }

  function connectWS(mid, clr) {
    const ws = new WebSocket(WSS + '/ws/' + mid + '/' + clr)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus(clr === 'white' ? 'Waiting for opponent...' : 'Game started!')
      if (screen !== 'game') setScreen('game')
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)

      if (msg.type === 'connected' || msg.type === 'state') {
        gameRef.current.load(msg.fen)
        setFen(msg.fen)
        setMyTurn(!msg.game_over && msg.turn === clr)
        if (screen !== 'game') setScreen('game')

        if (!msg.game_over) {
          if (msg.turn === clr) setStatus('Your turn!')
          else setStatus('Opponent thinking...')
        }

        if (msg.game_over && msg.result) {
          handleEnd(msg.result, clr)
        }
      }

      if (msg.type === 'gameover') {
        handleEnd(msg, clr)
      }
    }

    ws.onclose = () => setStatus('Disconnected')
    ws.onerror = () => setStatus('Connection error')
  }

  function handleEnd(r, clr) {
    setMyTurn(false)
    setResult(r)
    if (!r.winner) setStatus('Draw!')
    else if (r.winner === clr) setStatus('YOU WIN! +$' + (stake * 2 * 0.9).toFixed(2) + ' USDT')
    else setStatus('You lost.')
  }

  function onDrop(from, to) {
    if (!myTurn || result) return false
    const game = gameRef.current
    const moves = game.moves({ square: from, verbose: true })
    const mv = moves.find(m => m.to === to)
    if (!mv) return false
    const promo = mv.flags.includes('p') ? 'q' : undefined
    const r = game.move({ from, to, promotion: promo })
    if (!r) return false
    setFen(game.fen())
    setMyTurn(false)
    setStatus('Opponent thinking...')
    wsRef.current.send(JSON.stringify({ type: 'move', move: from + to + (promo || '') }))
    return true
  }

  function reset() {
    if (wsRef.current) wsRef.current.close()
    gameRef.current = new Chess()
    setScreen('home')
    setFen('start')
    setMyTurn(false)
    setColor(null)
    setResult(null)
    setMatchId('')
    setJoinId('')
    setStatus('')
  }

  const pool = stake * 2
  const win = pool * 0.9
  const fee = pool * 0.1

  const box = {
    background: '#16213e',
    border: '1px solid #0f3460',
    borderRadius: '12px',
    padding: '16px',
    width: '100%',
    maxWidth: '420px'
  }

  const btn = (bg, disabled) => ({
    background: disabled ? '#333' : bg,
    color: disabled ? '#666' : '#fff',
    border: 'none',
    padding: '13px',
    borderRadius: '10px',
    fontWeight: '700',
    fontSize: '1rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    width: '100%'
  })

  const page = {
    minHeight: '100vh',
    background: '#080B14',
    color: '#eaeaea',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '20px 12px',
    gap: '14px',
    fontFamily: 'sans-serif'
  }

  if (screen === 'home') return (
    <div style={page}>
      <div style={{ fontSize: '48px' }}>&#9823;</div>
      <h1 style={{ fontSize: '1.8rem', fontWeight: '900', color: '#818CF8' }}>
        CHESS ARENA
      </h1>
      <p style={{ color: '#6B7280', fontSize: '0.8rem' }}>
        @{tgUser.username || 'Player'}
      </p>

      <div style={box}>
        <p style={{ color: '#6B7280', fontSize: '0.75rem', marginBottom: '10px' }}>
          SET STAKE (USDT)
        </p>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
          {[1, 5, 10, 25, 50].map(v => (
            <button key={v} onClick={() => setStake(v)} style={{
              flex: 1, padding: '8px 2px',
              borderRadius: '8px',
              border: stake === v ? '2px solid #6366F1' : '1px solid #1a3a5c',
              background: stake === v ? 'rgba(99,102,241,0.2)' : 'transparent',
              color: stake === v ? '#A5B4FC' : '#6B7280',
              fontWeight: '700', fontSize: '0.8rem', cursor: 'pointer'
            }}>${v}</button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', textAlign: 'center', background: '#1a2236', borderRadius: '8px', padding: '10px' }}>
          <div>
            <div style={{ color: '#6B7280', fontSize: '0.7rem' }}>Pool</div>
            <div style={{ color: '#A5B4FC', fontWeight: '800' }}>${pool.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ color: '#6B7280', fontSize: '0.7rem' }}>You Win</div>
            <div style={{ color: '#10B981', fontWeight: '800' }}>${win.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ color: '#6B7280', fontSize: '0.7rem' }}>Fee</div>
            <div style={{ color: '#6B7280', fontWeight: '800' }}>${fee.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <button onClick={createMatch} disabled={loading} style={btn('#6366F1', loading)}>
        {loading ? 'Creating...' : 'Create New Match'}
      </button>

      <div style={box}>
        <p style={{ color: '#6B7280', fontSize: '0.75rem', marginBottom: '8px' }}>JOIN WITH MATCH ID</p>
        <input
          value={joinId}
          onChange={e => setJoinId(e.target.value)}
          placeholder="Paste match ID here..."
          style={{ width: '100%', background: '#0f1f3d', border: '1px solid #1a4a8a', borderRadius: '8px', padding: '10px', color: '#eaeaea', fontSize: '0.9rem', marginBottom: '10px' }}
        />
        <button onClick={joinMatch} disabled={loading || !joinId.trim()} style={btn('#3B82F6', loading || !joinId.trim())}>
          {loading ? 'Joining...' : 'Join Match'}
        </button>
      </div>

      {status !== '' && (
        <div style={{ background: '#1a2236', border: '1px solid #2a3550', borderRadius: '8px', padding: '10px 16px', color: '#A5B4FC', fontSize: '0.85rem', textAlign: 'center', width: '100%', maxWidth: '420px' }}>
          {status}
        </div>
      )}
    </div>
  )

  if (screen === 'lobby') return (
    <div style={page}>
      <div style={{ fontSize: '48px' }}>&#9876;</div>
      <h2 style={{ color: '#818CF8', fontWeight: '800' }}>Match Created!</h2>
      <p style={{ color: '#6B7280' }}>Share this ID with your opponent:</p>

      <div style={{ ...box, textAlign: 'center' }}>
        <div style={{ background: '#0f1f3d', border: '1px solid #2a4a8a', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all', color: '#A5B4FC', marginBottom: '12px' }}>
          {matchId}
        </div>
        <button onClick={() => { navigator.clipboard.writeText(matchId); setStatus('Copied!') }} style={btn('#3B82F6', false)}>
          Copy Match ID
        </button>
      </div>

      <div style={{ color: '#6B7280', fontSize: '0.85rem' }}>
        Waiting for opponent... Stake: ${stake}
      </div>

      {status !== '' && (
        <div style={{ color: '#A5B4FC', fontSize: '0.85rem' }}>{status}</div>
      )}

      <button onClick={reset} style={{ background: 'transparent', border: '1px solid #2a3550', color: '#6B7280', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer' }}>
        Cancel
      </button>
    </div>
  )

  return (
    <div style={page}>
      <div style={{ background: '#16213e', border: '1px solid #0f3460', borderRadius: '10px', padding: '10px 16px', width: '100%', maxWidth: '460px', textAlign: 'center', fontWeight: '600', fontSize: '0.9rem' }}>
        {status || 'Game in progress'}
      </div>

      <div style={{ width: 'min(460px, calc(100vw - 20px))' }}>
        <Chessboard
          position={fen}
          onPieceDrop={onDrop}
          boardOrientation={color === 'black' ? 'black' : 'white'}
          arePiecesDraggable={myTurn && !result}
          customDarkSquareStyle={{ backgroundColor: '#B06000' }}
          customLightSquareStyle={{ backgroundColor: '#F0C070' }}
        />
      </div>

      <div style={{ color: '#6B7280', fontSize: '0.8rem' }}>
        Playing as {color} | Stake ${stake} | Win ${win.toFixed(2)}
      </div>

      {result && (
        <button onClick={reset} style={btn('#6366F1', false)}>
          Play Again
        </button>
      )}
    </div>
  )
}
