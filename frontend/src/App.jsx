import { useState, useEffect, useRef, useCallback } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'

const API = 'https://chess-bot-production-efa2.up.railway.app'
const WSS = 'wss://chess-bot-production-efa2.up.railway.app'
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const tg = window.Telegram?.WebApp
const tgUser = tg?.initDataUnsafe?.user || { id: 0, username: 'Player' }

// ─── AI MOVE via Anthropic API ────────────────────────────────────────────────
async function fetchAIMove(fen, difficulty) {
  const chess = new Chess(fen)
  const legalMoves = chess.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''))

  if (legalMoves.length === 0) return null

  const difficultyPrompt = {
    easy:   'You are a beginner chess player. Occasionally make suboptimal or even bad moves. Avoid obvious tactics.',
    medium: 'You are an intermediate chess player. Play solid moves but miss complex combinations.',
    hard:   'You are a strong chess player. Play the best move you can find.'
  }[difficulty]

  const prompt = `${difficultyPrompt}

Current board FEN: ${fen}
Legal moves (UCI format): ${legalMoves.join(', ')}

Respond with ONLY a single move in UCI format (e.g. e2e4, g1f3, e7e8q). 
No explanation. No punctuation. Just the move string from the list above.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 16,
        messages: [{ role: 'user', content: prompt }]
      })
    })
    const data = await res.json()
    const raw = data?.content?.[0]?.text?.trim().toLowerCase().replace(/[^a-h1-8qrbn]/g, '')
    if (raw && legalMoves.includes(raw)) return raw
    // Fallback: pick random legal move if AI response is not in legal list
    return legalMoves[Math.floor(Math.random() * legalMoves.length)]
  } catch {
    return legalMoves[Math.floor(Math.random() * legalMoves.length)]
  }
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const S = {
  page: {
    minHeight: '100vh', background: '#080B14', color: '#eaeaea',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '20px 12px', gap: '14px', fontFamily: 'sans-serif'
  },
  box: {
    background: '#111827', border: '1px solid rgba(255,255,255,.08)',
    borderRadius: '12px', padding: '16px', width: '100%', maxWidth: '440px',
    boxSizing: 'border-box'
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
  }),
  modeBtn: (active) => ({
    flex: 1, padding: '11px 6px', borderRadius: '10px',
    border: active ? '2px solid #6366F1' : '1px solid #1f2937',
    background: active ? 'rgba(99,102,241,.15)' : 'transparent',
    color: active ? '#A5B4FC' : '#6B7280',
    fontWeight: '700', fontSize: '.82rem', cursor: 'pointer',
    transition: 'all .2s'
  }),
  diffBtn: (active, color) => ({
    flex: 1, padding: '9px 4px', borderRadius: '8px',
    border: active ? `2px solid ${color}` : '1px solid #1f2937',
    background: active ? `${color}22` : 'transparent',
    color: active ? color : '#6B7280',
    fontWeight: '700', fontSize: '.78rem', cursor: 'pointer',
    transition: 'all .2s'
  })
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  // shared
  const [screen, setScreen]     = useState('home')
  const [mode, setMode]         = useState('human')   // 'human' | 'computer'
  const [stake, setStake]       = useState(5)
  const [status, setStatus]     = useState('')
  const [loading, setLoading]   = useState(false)

  // multiplayer
  const [matchId, setMatchId]   = useState('')
  const [joinId, setJoinId]     = useState('')
  const [color, setColor]       = useState(null)
  const [result, setResult]     = useState(null)
  const [myTurnUI, setMyTurnUI] = useState(false)
  const [fen, setFen]           = useState(START_FEN)

  // vs computer
  const [playerColor, setPlayerColor]   = useState('white')  // which side human plays
  const [difficulty, setDifficulty]     = useState('medium')
  const [botThinking, setBotThinking]   = useState(false)
  const [gameOver, setGameOver]         = useState(false)
  const [moveHistory, setMoveHistory]   = useState([])

  const chessRef   = useRef(new Chess())
  const wsRef      = useRef(null)
  const colorRef   = useRef(null)

  useEffect(() => { tg?.ready(); tg?.expand() }, [])

  // ── VS COMPUTER: trigger bot move whenever it's the bot's turn ──────────────
  useEffect(() => {
    if (screen !== 'game' || mode !== 'computer' || gameOver || botThinking) return
    const chess = chessRef.current
    const currentTurn = chess.turn() === 'w' ? 'white' : 'black'
    if (currentTurn === playerColor) return   // human's turn
    if (chess.isGameOver()) return

    let cancelled = false
    setBotThinking(true)
    setStatus('🤖 Computer thinking...')

    fetchAIMove(chess.fen(), difficulty).then(uci => {
      if (cancelled) return
      if (!uci) { setBotThinking(false); return }

      const from = uci.slice(0, 2)
      const to   = uci.slice(2, 4)
      const promo = uci[4] || undefined

      try {
        const move = chess.move({ from, to, promotion: promo || 'q' })
        if (move) {
          setFen(chess.fen())
          setMoveHistory(h => [...h, move.san])
          checkComputerGameOver(chess)
        }
      } catch { /* illegal — skip */ }

      setBotThinking(false)
      if (!chess.isGameOver()) setStatus('⚡️ Your turn!')
    })

    return () => { cancelled = true }
  }, [fen, screen, mode, gameOver, playerColor, difficulty, botThinking])

  function checkComputerGameOver(chess) {
    if (!chess.isGameOver()) return
    setGameOver(true)
    setMyTurnUI(false)
    if (chess.isCheckmate()) {
      const winner = chess.turn() === 'w' ? 'black' : 'white'
      setStatus(winner === playerColor ? '🏆 You win! Checkmate!' : '💀 Computer wins! Checkmate.')
    } else if (chess.isDraw()) {
      setStatus('½ Draw!')
    } else {
      setStatus('Game over.')
    }
  }

  // ── START VS COMPUTER ───────────────────────────────────────────────────────
  function startVsComputer() {
    chessRef.current = new Chess()
    setFen(START_FEN)
    setGameOver(false)
    setBotThinking(false)
    setMoveHistory([])
    setResult(null)
    setScreen('game')
    if (playerColor === 'white') {
      setStatus('⚡️ Your turn! You play White.')
    } else {
      setStatus('🤖 Computer plays first...')
    }
  }

  // ── VS COMPUTER: human move handler ────────────────────────────────────────
  function onDropComputer(from, to) {
    if (gameOver || botThinking) return false
    const chess = chessRef.current
    const currentTurn = chess.turn() === 'w' ? 'white' : 'black'
    if (currentTurn !== playerColor) return false

    let move
    try {
      move = chess.move({ from, to, promotion: 'q' })
    } catch { return false }
    if (!move) return false

    const newFen = chess.fen()
    setFen(newFen)
    setMoveHistory(h => [...h, move.san])
    checkComputerGameOver(chess)
    return true
  }

  // ── MULTIPLAYER ─────────────────────────────────────────────────────────────
  function applyServerFen(newFen) {
    try {
      chessRef.current = new Chess(newFen)
      setFen(newFen)
    } catch (e) {
      console.error('Invalid FEN from server:', newFen, e)
    }
  }

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
      setStatus(clr === 'white' ? '⏳ Waiting for opponent...' : '⚡️ Game on!')
    }

    sock.onmessage = (evt) => {
      const msg = JSON.parse(evt.data)
      const myClr = colorRef.current

      if (msg.type === 'connected') {
        applyServerFen(msg.fen)
        setScreen('game')
        const mine = msg.turn === myClr
        setMyTurnUI(mine)
        setStatus(mine ? '⚡️ Your turn!' : '⏳ Waiting for opponent...')
        return
      }
      if (msg.type === 'state') {
        applyServerFen(msg.fen)
        const mine = msg.turn === myClr
        setMyTurnUI(mine && !msg.game_over)
        if (msg.game_over && msg.result) {
          endMultiGame(msg.result, myClr)
        } else {
          setStatus(mine ? '⚡️ Your turn!' : '⏳ Opponent thinking...')
        }
        return
      }
      if (msg.type === 'error') {
        if (msg.fen) applyServerFen(msg.fen)
        const mine = msg.turn ? msg.turn === myClr : myTurnUI
        setMyTurnUI(mine)
        setStatus('⚠️ ' + (msg.msg || 'Move rejected'))
        return
      }
      if (msg.type === 'gameover') {
        endMultiGame(msg, myClr)
      }
    }

    sock.onclose = () => setStatus('🔌 Disconnected')
    sock.onerror = () => setStatus('❌ Connection error')
  }

  function endMultiGame(r, clr) {
    setMyTurnUI(false)
    setResult(r)
    if (!r.winner) setStatus('½ Draw!')
    else if (r.winner === clr) setStatus('🏆 YOU WIN! +$' + (stake * 2 * 0.9).toFixed(2) + ' USDT')
    else setStatus('💀 You lost.')
  }

  // ── MULTIPLAYER: human move handler (snap-back fix) ─────────────────────────
  function onDropMulti(from, to) {
    if (result) return false
    if (!myTurnUI) return false

    // Validate locally first
    const probe = new Chess(chessRef.current.fen())
    let move
    try { move = probe.move({ from, to, promotion: 'q' }) }
    catch { return false }
    if (!move) return false

    // Optimistically update board so piece doesn't snap back
    chessRef.current = probe
    setFen(probe.fen())
    setMyTurnUI(false)
    setStatus('⏳ Sending move...')

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'move',
        move: from + to + (move.promotion || '')
      }))
    } else {
      setStatus('❌ Not connected')
      setMyTurnUI(true)
      return false
    }
    return true
  }

  // ── RESET ───────────────────────────────────────────────────────────────────
  function reset() {
    if (wsRef.current) wsRef.current.close()
    chessRef.current = new Chess()
    wsRef.current = null
    colorRef.current = null
    setScreen('home')
    setFen(START_FEN)
    setMyTurnUI(false)
    setColor(null)
    setResult(null)
    setMatchId('')
    setJoinId('')
    setStatus('')
    setLoading(false)
    setGameOver(false)
    setBotThinking(false)
    setMoveHistory([])
  }

  const pool = stake * 2
  const win  = pool * 0.9
  const fee  = pool * 0.1

  // ── HOME SCREEN ─────────────────────────────────────────────────────────────
  if (screen === 'home') return (
    <div style={S.page}>
      <div style={{ fontSize: 52 }}>♟</div>
      <h1 style={{ fontSize: '1.9rem', fontWeight: 900, color: '#818CF8', letterSpacing: '-1px', margin: 0 }}>
        CHESS ARENA
      </h1>
      <p style={{ color: '#6B7280', fontSize: '.8rem', margin: 0 }}>@{tgUser.username || 'Player'}</p>

      {/* Mode Selector */}
      <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 440 }}>
        <button onClick={() => setMode('computer')} style={S.modeBtn(mode === 'computer')}>
          🤖 vs Computer
        </button>
        <button onClick={() => setMode('human')} style={S.modeBtn(mode === 'human')}>
          ⚔️ vs Human
        </button>
      </div>

      {/* VS COMPUTER OPTIONS */}
      {mode === 'computer' && (
        <div style={S.box}>
          <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: 10 }}>
            PLAY AS
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onClick={() => setPlayerColor('white')} style={S.diffBtn(playerColor === 'white', '#F9FAFB')}>
              ♙ White
            </button>
            <button onClick={() => setPlayerColor('black')} style={S.diffBtn(playerColor === 'black', '#818CF8')}>
              ♟ Black
            </button>
          </div>

          <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: 10 }}>
            DIFFICULTY
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <button onClick={() => setDifficulty('easy')}   style={S.diffBtn(difficulty === 'easy',   '#10B981')}>🟢 Easy</button>
            <button onClick={() => setDifficulty('medium')} style={S.diffBtn(difficulty === 'medium', '#F59E0B')}>🟡 Medium</button>
            <button onClick={() => setDifficulty('hard')}   style={S.diffBtn(difficulty === 'hard',   '#EF4444')}>🔴 Hard</button>
          </div>

          <button onClick={startVsComputer} style={S.btn('linear-gradient(135deg,#6366F1,#8B5CF6)', false)}>
            🤖 Play vs Computer
          </button>
        </div>
      )}

      {/* VS HUMAN OPTIONS */}
      {mode === 'human' && (
        <>
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
            <input
              value={joinId}
              onChange={e => setJoinId(e.target.value)}
              placeholder="Paste match ID here..."
              style={{ width: '100%', background: '#0f1f3d', border: '1px solid #1a3a5c', borderRadius: '8px', padding: '11px', color: '#eaeaea', fontSize: '.9rem', marginBottom: '10px', boxSizing: 'border-box' }}
            />
            <button onClick={joinMatch} disabled={loading || !joinId.trim()}
              style={S.btn('linear-gradient(135deg,#3B82F6,#6366F1)', loading || !joinId.trim())}>
              {loading ? 'Joining...' : '🚀 Join Match'}
            </button>
          </div>
        </>
      )}

      {status && (
        <div style={{ background: 'rgba(99,102,241,.1)', border: '1px solid rgba(99,102,241,.3)', borderRadius: '8px', padding: '10px 16px', color: '#A5B4FC', fontSize: '.85rem', textAlign: 'center', width: '100%', maxWidth: 440 }}>
          {status}
        </div>
      )}
    </div>
  )

  // ── LOBBY ───────────────────────────────────────────────────────────────────
  if (screen === 'lobby') return (
    <div style={S.page}>
      <div style={{ fontSize: 52 }}>⚔️</div>
      <h2 style={{ fontWeight: 800, color: '#818CF8', fontSize: '1.4rem', margin: 0 }}>Match Created!</h2>
      <p style={{ color: '#6B7280', fontSize: '.85rem', margin: 0 }}>Share this ID with your opponent</p>

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

  // ── GAME SCREEN ─────────────────────────────────────────────────────────────
  const isComputerMode = mode === 'computer'
  const boardOrientation = isComputerMode ? playerColor : (color === 'black' ? 'black' : 'white')
  const isDraggable = isComputerMode
    ? (!gameOver && !botThinking && chessRef.current.turn() === (playerColor === 'white' ? 'w' : 'b'))
    : (myTurnUI && !result)

  return (
    <div style={{ ...S.page, padding: '10px 10px 28px', gap: 10 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: 460 }}>
        <div>
          <div style={{ fontWeight: 800, color: '#818CF8', fontSize: '.9rem' }}>♟ CHESS ARENA</div>
          <div style={{ color: '#6B7280', fontSize: '.72rem' }}>
            {isComputerMode
              ? <>You play <strong style={{ color: '#A5B4FC' }}>{playerColor}</strong> · {difficulty} mode</>
              : <>You are <strong style={{ color: '#A5B4FC' }}>{color}</strong> · ${stake} stake</>
            }
          </div>
        </div>
        <div style={{
          background: botThinking ? 'rgba(245,158,11,.1)' : isDraggable ? 'rgba(16,185,129,.1)' : 'rgba(99,102,241,.1)',
          border: `1px solid ${botThinking ? 'rgba(245,158,11,.3)' : isDraggable ? 'rgba(16,185,129,.3)' : 'rgba(99,102,241,.3)'}`,
          borderRadius: 8, padding: '5px 10px', fontSize: '.75rem', fontWeight: 700,
          color: botThinking ? '#F59E0B' : isDraggable ? '#10B981' : '#A5B4FC'
        }}>
          {botThinking ? '🤖 Thinking' : isDraggable ? '⚡️ Your turn' : '⏳ Waiting'}
        </div>
      </div>

      {/* Status bar */}
      <div style={{
        background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)',
        borderRadius: 10, padding: '10px 16px', fontSize: '.88rem', fontWeight: 600,
        textAlign: 'center', width: '100%', maxWidth: 460, color: '#A5B4FC', boxSizing: 'border-box'
      }}>
        {status || '♟ Game in progress'}
      </div>

      {/* Chess Board */}
      <div style={{ width: 'min(460px, calc(100vw - 16px))', borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,.6)' }}>
        <Chessboard
          id="chess-board"
          position={fen}
          onPieceDrop={isComputerMode ? onDropComputer : onDropMulti}
          boardOrientation={boardOrientation}
          arePiecesDraggable={isDraggable}
          animationDuration={200}
          customBoardStyle={{ borderRadius: 0 }}
          customDarkSquareStyle={{ backgroundColor: '#B45309' }}
          customLightSquareStyle={{ backgroundColor: '#FCD34D' }}
        />
      </div>

      {/* Move history (vs computer) */}
      {isComputerMode && moveHistory.length > 0 && (
        <div style={{ ...S.box, maxHeight: 80, overflowY: 'auto' }}>
          <p style={{ color: '#6B7280', fontSize: '.65rem', fontWeight: 700, letterSpacing: '1px', marginBottom: 6 }}>MOVES</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {moveHistory.map((m, i) => (
              <span key={i} style={{
                background: i % 2 === 0 ? 'rgba(255,255,255,.06)' : 'rgba(99,102,241,.1)',
                color: i % 2 === 0 ? '#9CA3AF' : '#A5B4FC',
                padding: '2px 7px', borderRadius: 4, fontSize: '.72rem', fontWeight: 600
              }}>
                {i % 2 === 0 ? `${Math.floor(i/2)+1}.` : ''}{m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Prize bar (multiplayer only) */}
      {!isComputerMode && (
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: 460, background: '#111827', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12, padding: '10px 16px', boxSizing: 'border-box' }}>
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
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 460 }}>
        {(result || gameOver) && (
          <button onClick={isComputerMode ? startVsComputer : reset}
            style={{ ...S.btn('linear-gradient(135deg,#6366F1,#8B5CF6)', false), flex: 1 }}>
            🔄 Play Again
          </button>
        )}
        <button onClick={reset}
          style={{ flex: result || gameOver ? '0 0 auto' : 1, padding: '13px 20px', background: 'transparent', border: '1px solid #1f2937', color: '#6B7280', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '.85rem' }}>
          ← Home
        </button>
      </div>
    </div>
  )
}
