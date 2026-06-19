import { useState, useEffect, useRef } from 'react'
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

  // Easy: just pick a random move — no API needed, fast and free
  if (difficulty === 'easy') {
    return legalMoves[Math.floor(Math.random() * legalMoves.length)]
  }

  const prompt = difficulty === 'hard'
    ? `You are a strong chess engine. Current FEN: ${fen}\nLegal moves (UCI): ${legalMoves.join(', ')}\nReply with ONLY the best move string. No explanation.`
    : `You are an intermediate chess player. Current FEN: ${fen}\nLegal moves (UCI): ${legalMoves.join(', ')}\nReply with ONLY one move string from the list. No explanation.`

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
    const raw = (data?.content?.[0]?.text || '').trim().toLowerCase().replace(/[^a-h1-8qrbn]/g, '')
    if (raw && legalMoves.includes(raw)) return raw
  } catch {}
  return legalMoves[Math.floor(Math.random() * legalMoves.length)]
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
  diffBtn: (active, col) => ({
    flex: 1, padding: '9px 4px', borderRadius: '8px',
    border: active ? `2px solid ${col}` : '1px solid #1f2937',
    background: active ? `${col}22` : 'transparent',
    color: active ? col : '#6B7280',
    fontWeight: '700', fontSize: '.78rem', cursor: 'pointer',
    transition: 'all .2s'
  })
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  // shared
  const [screen, setScreen]   = useState('home')
  const [mode, setMode]       = useState('human')
  const [stake, setStake]     = useState(5)
  const [status, setStatus]   = useState('')
  const [loading, setLoading] = useState(false)
  const [fen, setFen]         = useState(START_FEN)

  // multiplayer
  const [matchId, setMatchId] = useState('')
  const [joinId, setJoinId]   = useState('')
  const [color, setColor]     = useState(null)
  const [result, setResult]   = useState(null)
  const [myTurnUI, setMyTurnUI] = useState(false)

  // vs computer
  const [playerColor, setPlayerColor] = useState('white')
  const [difficulty, setDifficulty]   = useState('medium')
  const [botThinking, setBotThinking] = useState(false)
  const [gameOver, setGameOver]       = useState(false)
  const [moveHistory, setMoveHistory] = useState([])

  // click-to-move state
  const [selectedSq, setSelectedSq]       = useState(null)   // e.g. 'e2'
  const [legalTargets, setLegalTargets]   = useState([])     // e.g. ['e3','e4']

  const chessRef  = useRef(new Chess())
  const wsRef     = useRef(null)
  const colorRef  = useRef(null)

  useEffect(() => { tg?.ready(); tg?.expand() }, [])

  // ─── Build custom square styles for highlights ────────────────────────────
  function buildSquareStyles(selected, targets, difficulty) {
    const styles = {}
    if (selected) {
      // selected piece square — bright ring
      styles[selected] = {
        background: 'rgba(99,102,241,0.55)',
        borderRadius: '4px'
      }
    }
    targets.forEach(sq => {
      // For easy mode show filled circle hint, other modes show subtle dot
      const showHint = difficulty === 'easy'
      styles[sq] = {
        background: showHint
          ? 'radial-gradient(circle, rgba(16,185,129,0.75) 36%, transparent 40%)'
          : 'radial-gradient(circle, rgba(255,255,255,0.25) 28%, transparent 32%)',
        borderRadius: '50%'
      }
    })
    return styles
  }

  // ─── Click-to-move handler (used by onSquareClick) ───────────────────────
  function handleSquareClick(square) {
    const chess = chessRef.current

    // If a piece is already selected and the clicked square is a legal target → move it
    if (selectedSq && legalTargets.includes(square)) {
      executeLocalMove(selectedSq, square)
      return
    }

    // Try to select a piece on this square that belongs to the current player
    const piece = chess.get(square)
    const myTurn = chess.turn() === (playerColor === 'white' ? 'w' : 'b')

    if (piece && myTurn && piece.color === (playerColor === 'white' ? 'w' : 'b')) {
      const moves = chess.moves({ square, verbose: true })
      setSelectedSq(square)
      setLegalTargets(moves.map(m => m.to))
    } else {
      // Deselect
      setSelectedSq(null)
      setLegalTargets([])
    }
  }

  // ─── Execute a local move (vs computer) ─────────────────────────────────
  function executeLocalMove(from, to) {
    if (gameOver || botThinking) return false
    const chess = chessRef.current
    let move
    try { move = chess.move({ from, to, promotion: 'q' }) }
    catch { return false }
    if (!move) return false

    setSelectedSq(null)
    setLegalTargets([])
    setFen(chess.fen())
    setMoveHistory(h => [...h, move.san])
    checkComputerGameOver(chess)
    return true
  }

  // ─── Drag-and-drop handler (vs computer) — same logic, no snap ──────────
  function onDropComputer(from, to) {
    if (gameOver || botThinking) return false
    const chess = chessRef.current
    const myTurn = chess.turn() === (playerColor === 'white' ? 'w' : 'b')
    if (!myTurn) return false
    return executeLocalMove(from, to)
  }

  // ─── Bot move trigger ─────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'game' || mode !== 'computer' || gameOver || botThinking) return
    const chess = chessRef.current
    const botColor = playerColor === 'white' ? 'b' : 'w'
    if (chess.turn() !== botColor) return
    if (chess.isGameOver()) return

    let cancelled = false
    setBotThinking(true)
    setStatus('🤖 Computer thinking...')

    fetchAIMove(chess.fen(), difficulty).then(uci => {
      if (cancelled) return
      if (!uci) { setBotThinking(false); return }

      const from  = uci.slice(0, 2)
      const to    = uci.slice(2, 4)
      const promo = uci[4] || 'q'

      try {
        const move = chess.move({ from, to, promotion: promo })
        if (move) {
          setFen(chess.fen())
          setMoveHistory(h => [...h, move.san])
          checkComputerGameOver(chess)
        }
      } catch {}
      setBotThinking(false)
      if (!chess.isGameOver()) setStatus('⚡️ Your turn!')
    })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, screen, mode, gameOver, botThinking])

  function checkComputerGameOver(chess) {
    if (!chess.isGameOver()) return
    setGameOver(true)
    if (chess.isCheckmate()) {
      const winner = chess.turn() === 'w' ? 'black' : 'white'
      setStatus(winner === playerColor ? '🏆 You win! Checkmate!' : '💀 Computer wins! Checkmate.')
    } else {
      setStatus('½ Draw!')
    }
  }

  function startVsComputer() {
    chessRef.current = new Chess()
    setFen(START_FEN)
    setGameOver(false)
    setBotThinking(false)
    setMoveHistory([])
    setResult(null)
    setSelectedSq(null)
    setLegalTargets([])
    setScreen('game')
    setStatus(playerColor === 'white' ? '⚡️ Your turn! You play White.' : '🤖 Computer plays first...')
  }

  // ─── MULTIPLAYER ──────────────────────────────────────────────────────────
  function applyServerFen(newFen) {
    try {
      chessRef.current = new Chess(newFen)
      setFen(newFen)
    } catch (e) { console.error('Invalid FEN:', newFen, e) }
  }

  async function createMatch() {
    setLoading(true); setStatus('Creating...')
    try {
      const res = await fetch(API + '/api/match/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-init-data': 'test' },
        body: JSON.stringify({ stake })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(data))
      setMatchId(data.match_id)
      colorRef.current = 'white'; setColor('white')
      setScreen('lobby'); connect(data.match_id, 'white')
    } catch (e) { setStatus('Error: ' + e.message) }
    setLoading(false)
  }

  async function joinMatch() {
    if (!joinId.trim()) { setStatus('Enter match ID'); return }
    setLoading(true)
    try {
      const res = await fetch(API + '/api/match/' + joinId.trim() + '/join', {
        method: 'POST', headers: { 'x-init-data': 'test' }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(data))
      colorRef.current = 'black'; setColor('black')
      setScreen('game'); connect(joinId.trim(), 'black')
    } catch (e) { setStatus('Error: ' + e.message) }
    setLoading(false)
  }

  function connect(mid, clr) {
    const sock = new WebSocket(WSS + '/ws/' + mid + '/' + clr)
    wsRef.current = sock
    sock.onopen = () => setStatus(clr === 'white' ? '⏳ Waiting for opponent...' : '⚡️ Game on!')
    sock.onmessage = (evt) => {
      const msg = JSON.parse(evt.data)
      const myClr = colorRef.current
      if (msg.type === 'connected') {
        applyServerFen(msg.fen); setScreen('game')
        const mine = msg.turn === myClr
        setMyTurnUI(mine)
        setStatus(mine ? '⚡️ Your turn!' : '⏳ Waiting for opponent...')
        return
      }
      if (msg.type === 'state') {
        applyServerFen(msg.fen)
        // Clear any pending selection since board resynced
        setSelectedSq(null); setLegalTargets([])
        const mine = msg.turn === myClr
        setMyTurnUI(mine && !msg.game_over)
        if (msg.game_over && msg.result) endMultiGame(msg.result, myClr)
        else setStatus(mine ? '⚡️ Your turn!' : '⏳ Opponent thinking...')
        return
      }
      if (msg.type === 'error') {
        if (msg.fen) applyServerFen(msg.fen)
        setSelectedSq(null); setLegalTargets([])
        const mine = msg.turn ? msg.turn === myClr : myTurnUI
        setMyTurnUI(mine)
        setStatus('⚠️ ' + (msg.msg || 'Move rejected'))
        return
      }
      if (msg.type === 'gameover') endMultiGame(msg, myClr)
    }
    sock.onclose = () => setStatus('🔌 Disconnected')
    sock.onerror = () => setStatus('❌ Connection error')
  }

  function endMultiGame(r, clr) {
    setMyTurnUI(false); setResult(r)
    setSelectedSq(null); setLegalTargets([])
    if (!r.winner) setStatus('½ Draw!')
    else if (r.winner === clr) setStatus('🏆 YOU WIN! +$' + (stake * 2 * 0.9).toFixed(2) + ' USDT')
    else setStatus('💀 You lost.')
  }

  // ─── Multiplayer click-to-move ────────────────────────────────────────────
  function handleMultiSquareClick(square) {
    if (!myTurnUI || result) return
    const chess = chessRef.current
    const myChessColor = colorRef.current === 'white' ? 'w' : 'b'

    if (selectedSq && legalTargets.includes(square)) {
      // Execute via server
      const probe = new Chess(chess.fen())
      let move
      try { move = probe.move({ from: selectedSq, to: square, promotion: 'q' }) }
      catch { setSelectedSq(null); setLegalTargets([]); return }
      if (!move) { setSelectedSq(null); setLegalTargets([]); return }

      // Optimistic local update so board doesn't snap back
      chessRef.current = probe
      setFen(probe.fen())
      setSelectedSq(null); setLegalTargets([])
      setMyTurnUI(false); setStatus('⏳ Sending move...')

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'move',
          move: selectedSq + square + (move.promotion || '')
        }))
      } else {
        setStatus('❌ Not connected'); setMyTurnUI(true)
      }
      return
    }

    // Select a piece
    const piece = chess.get(square)
    if (piece && piece.color === myChessColor) {
      const moves = chess.moves({ square, verbose: true })
      setSelectedSq(square)
      setLegalTargets(moves.map(m => m.to))
    } else {
      setSelectedSq(null); setLegalTargets([])
    }
  }

  // ─── Multiplayer drag-and-drop (snap-back fix) ────────────────────────────
  function onDropMulti(from, to) {
    if (!myTurnUI || result) return false
    const probe = new Chess(chessRef.current.fen())
    let move
    try { move = probe.move({ from, to, promotion: 'q' }) }
    catch { return false }
    if (!move) return false

    chessRef.current = probe
    setFen(probe.fen())
    setSelectedSq(null); setLegalTargets([])
    setMyTurnUI(false); setStatus('⏳ Sending move...')

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'move', move: from + to + (move.promotion || '') }))
    } else {
      setStatus('❌ Not connected'); setMyTurnUI(true); return false
    }
    return true
  }

  function reset() {
    if (wsRef.current) wsRef.current.close()
    chessRef.current = new Chess()
    wsRef.current = null; colorRef.current = null
    setScreen('home'); setFen(START_FEN)
    setMyTurnUI(false); setColor(null); setResult(null)
    setMatchId(''); setJoinId(''); setStatus(''); setLoading(false)
    setGameOver(false); setBotThinking(false); setMoveHistory([])
    setSelectedSq(null); setLegalTargets([])
  }

  const pool = stake * 2, win = pool * 0.9, fee = pool * 0.1

  // ─── HOME ─────────────────────────────────────────────────────────────────
  if (screen === 'home') return (
    <div style={S.page}>
      <div style={{ fontSize: 52 }}>♟</div>
      <h1 style={{ fontSize: '1.9rem', fontWeight: 900, color: '#818CF8', letterSpacing: '-1px', margin: 0 }}>
        CHESS ARENA
      </h1>
      <p style={{ color: '#6B7280', fontSize: '.8rem', margin: 0 }}>@{tgUser.username || 'Player'}</p>

      <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 440 }}>
        <button onClick={() => setMode('computer')} style={S.modeBtn(mode === 'computer')}>🤖 vs Computer</button>
        <button onClick={() => setMode('human')}    style={S.modeBtn(mode === 'human')}>⚔️ vs Human</button>
      </div>

      {mode === 'computer' && (
        <div style={S.box}>
          <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: 10 }}>PLAY AS</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onClick={() => setPlayerColor('white')} style={S.diffBtn(playerColor === 'white', '#F9FAFB')}>♙ White</button>
            <button onClick={() => setPlayerColor('black')} style={S.diffBtn(playerColor === 'black', '#818CF8')}>♟ Black</button>
          </div>
          <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: 10 }}>DIFFICULTY</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <button onClick={() => setDifficulty('easy')}   style={S.diffBtn(difficulty === 'easy',   '#10B981')}>🟢 Easy</button>
            <button onClick={() => setDifficulty('medium')} style={S.diffBtn(difficulty === 'medium', '#F59E0B')}>🟡 Medium</button>
            <button onClick={() => setDifficulty('hard')}   style={S.diffBtn(difficulty === 'hard',   '#EF4444')}>🔴 Hard</button>
          </div>
          {difficulty === 'easy' && (
            <p style={{ color: '#10B981', fontSize: '.7rem', marginTop: 8, marginBottom: 14 }}>
              💡 Easy mode shows possible moves when you select a piece
            </p>
          )}
          <button onClick={startVsComputer} style={S.btn('linear-gradient(135deg,#6366F1,#8B5CF6)', false)}>
            🤖 Play vs Computer
          </button>
        </div>
      )}

      {mode === 'human' && (
        <>
          <div style={S.box}>
            <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: '10px' }}>SET STAKE (USDT)</p>
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
          <button onClick={createMatch} disabled={loading} style={S.btn('linear-gradient(135deg,#6366F1,#8B5CF6)', loading)}>
            {loading ? 'Creating...' : '⚔️ Create New Match'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', maxWidth: 440 }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.06)' }} />
            <span style={{ color: '#4B5563', fontSize: '.78rem', fontWeight: 600 }}>OR JOIN</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.06)' }} />
          </div>
          <div style={S.box}>
            <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: '10px' }}>JOIN WITH MATCH ID</p>
            <input value={joinId} onChange={e => setJoinId(e.target.value)} placeholder="Paste match ID here..."
              style={{ width: '100%', background: '#0f1f3d', border: '1px solid #1a3a5c', borderRadius: '8px', padding: '11px', color: '#eaeaea', fontSize: '.9rem', marginBottom: '10px', boxSizing: 'border-box' }} />
            <button onClick={joinMatch} disabled={loading || !joinId.trim()} style={S.btn('linear-gradient(135deg,#3B82F6,#6366F1)', loading || !joinId.trim())}>
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

  // ─── LOBBY ────────────────────────────────────────────────────────────────
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
          style={S.btn('linear-gradient(135deg,#3B82F6,#6366F1)', false)}>📋 Copy Match ID</button>
      </div>
      <div style={{ color: '#6B7280', fontSize: '.85rem' }}>⏳ Waiting for opponent...</div>
      {status && <div style={{ color: '#10B981', fontSize: '.85rem' }}>{status}</div>}
      <button onClick={reset} style={{ background: 'transparent', border: '1px solid #1f2937', color: '#6B7280', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer', fontSize: '.85rem' }}>← Cancel</button>
    </div>
  )

  // ─── GAME ─────────────────────────────────────────────────────────────────
  const isBot = mode === 'computer'
  const boardOri = isBot ? playerColor : (color === 'black' ? 'black' : 'white')

  // Is it the human's turn to move?
  const humanTurn = isBot
    ? (!gameOver && !botThinking && chessRef.current.turn() === (playerColor === 'white' ? 'w' : 'b'))
    : (myTurnUI && !result)

  // Custom square styles: selected piece + legal target dots
  const squareStyles = humanTurn
    ? buildSquareStyles(selectedSq, legalTargets, isBot ? difficulty : 'none')
    : {}

  return (
    <div style={{ ...S.page, padding: '10px 10px 28px', gap: 10 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: 460 }}>
        <div>
          <div style={{ fontWeight: 800, color: '#818CF8', fontSize: '.9rem' }}>♟ CHESS ARENA</div>
          <div style={{ color: '#6B7280', fontSize: '.72rem' }}>
            {isBot
              ? <>You play <strong style={{ color: '#A5B4FC' }}>{playerColor}</strong> · {difficulty} mode</>
              : <>You are <strong style={{ color: '#A5B4FC' }}>{color}</strong> · ${stake} stake</>
            }
          </div>
        </div>
        <div style={{
          background: botThinking ? 'rgba(245,158,11,.1)' : humanTurn ? 'rgba(16,185,129,.1)' : 'rgba(99,102,241,.1)',
          border: `1px solid ${botThinking ? 'rgba(245,158,11,.3)' : humanTurn ? 'rgba(16,185,129,.3)' : 'rgba(99,102,241,.3)'}`,
          borderRadius: 8, padding: '5px 10px', fontSize: '.75rem', fontWeight: 700,
          color: botThinking ? '#F59E0B' : humanTurn ? '#10B981' : '#A5B4FC'
        }}>
          {botThinking ? '🤖 Thinking' : humanTurn ? '⚡️ Your turn' : '⏳ Waiting'}
        </div>
      </div>

      {/* Status */}
      <div style={{
        background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)',
        borderRadius: 10, padding: '10px 16px', fontSize: '.88rem', fontWeight: 600,
        textAlign: 'center', width: '100%', maxWidth: 460, color: '#A5B4FC', boxSizing: 'border-box'
      }}>
        {status || '♟ Game in progress'}
      </div>

      {/* Board */}
      <div style={{ width: 'min(460px, calc(100vw - 16px))', borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,.6)' }}>
        <Chessboard
          id="chess-board"
          position={fen}
          boardOrientation={boardOri}
          onPieceDrop={isBot ? onDropComputer : onDropMulti}
          onSquareClick={isBot ? handleSquareClick : handleMultiSquareClick}
          arePiecesDraggable={humanTurn}
          animationDuration={180}
          customSquareStyles={squareStyles}
          customBoardStyle={{ borderRadius: 0 }}
          customDarkSquareStyle={{ backgroundColor: '#B45309' }}
          customLightSquareStyle={{ backgroundColor: '#FCD34D' }}
        />
      </div>

      {/* Hint label for easy mode */}
      {isBot && difficulty === 'easy' && humanTurn && !gameOver && (
        <div style={{ color: '#10B981', fontSize: '.72rem', textAlign: 'center', opacity: 0.85 }}>
          💡 Tap a piece to see where it can move
        </div>
      )}

      {/* Move history */}
      {isBot && moveHistory.length > 0 && (
        <div style={{ ...S.box, maxHeight: 72, overflowY: 'auto' }}>
          <p style={{ color: '#6B7280', fontSize: '.65rem', fontWeight: 700, letterSpacing: '1px', marginBottom: 6 }}>MOVES</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {moveHistory.map((m, i) => (
              <span key={i} style={{
                background: i % 2 === 0 ? 'rgba(255,255,255,.06)' : 'rgba(99,102,241,.1)',
                color: i % 2 === 0 ? '#9CA3AF' : '#A5B4FC',
                padding: '2px 7px', borderRadius: 4, fontSize: '.72rem', fontWeight: 600
              }}>
                {i % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : ''}{m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Prize bar (multiplayer) */}
      {!isBot && (
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

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 460 }}>
        {(result || gameOver) && (
          <button onClick={isBot ? startVsComputer : reset}
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
