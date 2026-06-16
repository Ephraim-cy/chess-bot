import { useState, useEffect, useRef } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'

// ← Replace this with your Railway URL after deploy (Step 17)
const API_URL = 'https://chess-bot-production-efa2.up.railway.app'
const WS_URL  = 'wss://chess-bot-production-efa2.up.railway.app
export default function App() {
  const [game]        = useState(new Chess())
  const [fen, setFen] = useState('start')
  const [status, setStatus]   = useState('Waiting to connect...')
  const [color, setColor]     = useState(null)   // 'white' or 'black'
  const [matchId, setMatchId] = useState(null)
  const [myTurn, setMyTurn]   = useState(false)
  const wsRef = useRef(null)

  // Get Telegram user data
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user || { id: 9999, username: 'testuser' }
  const initData = window.Telegram?.WebApp?.initData || 'test'

  // Tell Telegram the app is ready
  useEffect(() => {
    window.Telegram?.WebApp?.ready()
    window.Telegram?.WebApp?.expand()
  }, [])

  async function createMatch() {
    setStatus('Creating match...')
    const res = await fetch(${API_URL}/api/match/create, {
      method: 'POST',
      headers: { 'x-init-data': initData }
    })
    const data = await res.json()
    setMatchId(data.match_id)
    setColor('white')
    setStatus(Match ID: ${data.match_id.slice(0,8)}... Share this with your opponent!)
    connectWebSocket(data.match_id, 'white')
  }

  async function joinMatch() {
    const id = prompt('Enter Match ID:')
    if (!id) return
    const res = await fetch(${API_URL}/api/match/${id}/join, {
      method: 'POST',
      headers: { 'x-init-data': initData }
    })
    if (!res.ok) { setStatus('Could not join match'); return }
    setMatchId(id)
    setColor('black')
    connectWebSocket(id, 'black')
  }

  function connectWebSocket(mid, clr) {
    const ws = new WebSocket(${WS_URL}/ws/${mid}/${clr})
    wsRef.current = ws

    ws.onopen = () => setStatus(Connected as ${clr}. ${clr === 'white' ? 'Your turn!' : 'Waiting for White...'})

    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data)

      if (msg.type === 'connected' || msg.type === 'state') {
        game.load(msg.fen)
        setFen(msg.fen)
        const itIsMyTurn = msg.turn === clr
        setMyTurn(itIsMyTurn)

        if (!msg.game_over) {
          setStatus(itIsMyTurn ? '⚡ Your turn!' : '⏳ Opponent\'s turn...')
          if (msg.in_check && itIsMyTurn) setStatus('⚠️ You are in Check!')
        }
      }

      if (msg.type === 'gameover' || (msg.type === 'state' && msg.game_over)) {
        const r = msg.result || msg
        if (!r.winner) setStatus('½ Draw — ' + r.reason)
        else if (r.winner === clr) setStatus('🏆 You Win!')
        else setStatus('💀 You Lost.')
        setMyTurn(false)
      }
    }

    ws.onerror = () => setStatus('Connection error — try again')
    ws.onclose = () => setStatus('Disconnected')
  }

  function onPieceDrop(from, to) {
    if (!myTurn) return false

    const moves = game.moves({ square: from, verbose: true })
    const move  = moves.find(m => m.to === to)
    if (!move) return false

    const promotion = move.flags.includes('p') ? 'q' : undefined
    const result = game.move({ from, to, promotion })
    if (!result) return false

    setFen(game.fen())
    setMyTurn(false)
    setStatus('⏳ Opponent\'s turn...')

    wsRef.current?.send(JSON.stringify({
      type: 'move',
      move: from + to + (promotion || '')
    }))

    return true
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'16px', gap:'14px', width:'100%' }}>

      <h1 style={{ fontSize:'1.4rem', fontWeight:800, letterSpacing:'3px',
        background:'linear-gradient(135deg,#e94560,#378add)',
        WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
        ♟ CHESS ARENA
      </h1>

      <div style={{ background:'#16213e', border:'1px solid #0f3460', borderRadius:'10px',
        padding:'10px 18px', fontSize:'.88rem', textAlign:'center', maxWidth:'360px' }}>
        {status}
      </div><div style={{ width:'min(420px, calc(100vw - 24px))' }}>
        <Chessboard
          position={fen}
          onPieceDrop={onPieceDrop}
          boardOrientation={color === 'black' ? 'black' : 'white'}
          arePiecesDraggable={myTurn}
          customBoardStyle={{ borderRadius:'8px', boxShadow:'0 8px 28px rgba(0,0,0,.6)' }}
          customDarkSquareStyle={{ backgroundColor:'#B58863' }}
          customLightSquareStyle={{ backgroundColor:'#F0D9B5' }}
        />
      </div>

      {!matchId && (
        <div style={{ display:'flex', gap:'10px' }}>
          <button onClick={createMatch} style={btnStyle('#e94560')}>
            ➕ New Game
          </button>
          <button onClick={joinMatch} style={btnStyle('#185fa5')}>
            🔗 Join Game
          </button>
        </div>
      )}

      <div style={{ fontSize:'.75rem', color:'#555', marginTop:'4px' }}>
        Playing as: {color  '–'} · {tgUser.username  'Guest'}
      </div>
    </div>
  )
}

function btnStyle(bg) {
  return {
    background: bg, color:'#fff', border:'none',
    padding:'10px 22px', borderRadius:'8px',
    fontWeight:700, fontSize:'.88rem', cursor:'pointer'
  }
}