import { useState, useEffect, useRef } from 'react'
import { Chess } from 'chess.js'

const API = 'https://chess-bot-production-efa2.up.railway.app'
const WSS = 'wss://chess-bot-production-efa2.up.railway.app'
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const tg = window.Telegram?.WebApp
const tgUser = tg?.initDataUnsafe?.user || { id: 0, username: 'Player' }

// ─── PIECE UNICODE ────────────────────────────────────────────────────────────
const PIECES = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
}

/*// ─── AI MOVE ──────────────────────────────────────────────────────────────────
async function fetchAIMove(fen, difficulty) {
  const chess = new Chess(fen)
  const legal = chess.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''))
  if (!legal.length) return null
  if (difficulty === 'easy') return legal[Math.floor(Math.random() * legal.length)]

  const prompt = `You are a ${difficulty === 'hard' ? 'strong' : 'intermediate'} chess player.
FEN: ${fen}
Legal moves (UCI): ${legal.join(', ')}
Reply with ONLY one move string from the list. Nothing else.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 16,
        messages: [{ role: 'user', content: prompt }]
      })
    })
    const data = await res.json()
    const raw = (data?.content?.[0]?.text || '').trim().toLowerCase().replace(/[^a-h1-8qrbn]/g, '')
    if (raw && legal.includes(raw)) return raw
  } catch {}
  return legal[Math.floor(Math.random() * legal.length)]
}*/
// ─── LOCAL CHESS ENGINE (minimax — instant, no API) ──────────────────────────
const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 }

const PST = {
  p: [ 0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0 ],
  n: [ -50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50 ],
  b: [ -20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20 ],
  r: [ 0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0 ],
  q: [ -20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20 ],
  k: [ -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20 ]
}

function evaluateBoard(chess) {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? -99999 : 99999
  if (chess.isDraw()) return 0
  let score = 0
  chess.board().forEach((row, ri) => {
    row.forEach((piece, fi) => {
      if (!piece) return
      const pstIdx = piece.color === 'w' ? (7 - ri) * 8 + fi : ri * 8 + fi
      const val = PIECE_VALUE[piece.type] + (PST[piece.type]?.[pstIdx] || 0)
      score += piece.color === 'w' ? val : -val
    })
  })
  return score
}

function minimax(chess, depth, alpha, beta, maximizing) {
  if (depth === 0 || chess.isGameOver()) return evaluateBoard(chess)
  const moves = chess.moves()
  if (maximizing) {
    let best = -Infinity
    for (const move of moves) {
      chess.move(move); best = Math.max(best, minimax(chess, depth-1, alpha, beta, false)); chess.undo()
      alpha = Math.max(alpha, best); if (beta <= alpha) break
    }
    return best
  } else {
    let best = Infinity
    for (const move of moves) {
      chess.move(move); best = Math.min(best, minimax(chess, depth-1, alpha, beta, true)); chess.undo()
      beta = Math.min(beta, best); if (beta <= alpha) break
    }
    return best
  }
}

function fetchAIMove(fen, difficulty) {
  return new Promise(resolve => {
    setTimeout(() => {
      const chess = new Chess(fen)
      const moves = chess.moves({ verbose: true })
      if (!moves.length) return resolve(null)
      if (difficulty === 'easy') {
        const m = moves[Math.floor(Math.random() * moves.length)]
        return resolve(m.from + m.to + (m.promotion || ''))
      }
      const depth = difficulty === 'hard' ? 3 : 2
      const isMax = chess.turn() === 'w'
      let bestScore = isMax ? -Infinity : Infinity, bestMove = moves[0]
      for (let i = moves.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [moves[i],moves[j]]=[moves[j],moves[i]] }
      for (const move of moves) {
        chess.move(move)
        const score = minimax(chess, depth-1, -Infinity, Infinity, !isMax)
        chess.undo()
        if (isMax ? score > bestScore : score < bestScore) { bestScore = score; bestMove = move }
      }
      resolve(bestMove.from + bestMove.to + (bestMove.promotion || ''))
    }, 100)
  })
}

// ─── CUSTOM CHESS BOARD ───────────────────────────────────────────────────────
function ChessBoard({ chess, orientation, selectedSq, legalTargets, onSquareTap, showHints, lastMove }) {
  const files = ['a','b','c','d','e','f','g','h']
  const ranks = ['8','7','6','5','4','3','2','1']

  // flip for black orientation
  const displayFiles = orientation === 'black' ? [...files].reverse() : files
  const displayRanks = orientation === 'black' ? [...ranks].reverse() : ranks

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(8, 1fr)',
      width: '100%',
      aspectRatio: '1 / 1',
      borderRadius: 6,
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0,0,0,.7)',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      touchAction: 'manipulation'
    }}>
      {displayRanks.map(rank =>
        displayFiles.map(file => {
          const sq = file + rank
          const fileIdx = files.indexOf(file)
          const rankIdx = ranks.indexOf(rank)
          const isLight = (fileIdx + rankIdx) % 2 === 0
          const piece = chess.get(sq)
          const pieceKey = piece ? piece.color + piece.type.toUpperCase() : null
          const isSelected = sq === selectedSq
          const isLegal = legalTargets.includes(sq)
          const isLastFrom = lastMove && lastMove.from === sq
          const isLastTo   = lastMove && lastMove.to === sq
          const hasPiece = !!piece

          // Square background
        //  let bg = isLight ? '#FCD34D' : '#B45309'
        let bg = isLight ? '#F0D9B5' : '#B58863'
          if (isSelected) bg = '#6366F1'
          else if (isLastFrom || isLastTo) bg = isLight ? '#a3e635' : '#65a30d'

          return (
            <div
              key={sq}
              onPointerDown={(e) => {
                e.preventDefault()
                onSquareTap(sq)
              }}
              style={{
                position: 'relative',
                background: bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {/* Legal move indicator */}
              {isLegal && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                  zIndex: 2
                }}>
                  {hasPiece ? (
                    // Capture ring
                    <div style={{
                      width: '90%', height: '90%',
                      borderRadius: '50%',
                      border: showHints ? '4px solid rgba(16,185,129,0.85)' : '3px solid rgba(255,255,255,0.4)',
                      boxSizing: 'border-box'
                    }} />
                  ) : (
                    // Move dot
                    <div style={{
                      width: showHints ? '44%' : '30%',
                      height: showHints ? '44%' : '30%',
                      borderRadius: '50%',
                      background: showHints ? 'rgba(16,185,129,0.8)' : 'rgba(255,255,255,0.35)'
                    }} />
                  )}
                </div>
              )}

              {/* Piece */}
              {pieceKey && (
                <span style={{
                 fontSize: 'clamp(22px, 6.5vw, 46px)',
                  lineHeight: 1,
                zIndex: 3,
                filter: isSelected 
                ? 'brightness(1.3) drop-shadow(0 0 8px rgba(255,215,0,0.9))'
                : piece.color === 'w'
                 ? 'drop-shadow(1px 2px 2px rgba(0,0,0,0.6)) brightness(1.15)'
                 : 'drop-shadow(1px 2px 2px rgba(0,0,0,0.8)) brightness(0.85)',
        transition: 'filter 0.1s'
                 /* fontSize: 'clamp(20px, 6vw, 42px)',
                  lineHeight: 1,
                  zIndex: 3,
                  filter: isSelected ? 'brightness(1.4) drop-shadow(0 0 6px rgba(255,255,255,0.8))' : 'drop-shadow(1px 1px 1px rgba(0,0,0,0.5))',
                  transition: 'filter 0.1s'*/
                }}>
                  {PIECES[pieceKey]}
                </span>
              )}

              {/* Rank/File labels on edge squares */}
              {file === displayFiles[0] && (
                <span style={{ position: 'absolute', top: 2, left: 3, fontSize: 9, fontWeight: 700, color: isLight ? '#B45309' : '#FCD34D', opacity: 0.7, lineHeight: 1 }}>
                  {rank}
                </span>
              )}
              {rank === displayRanks[7] && (
                <span style={{ position: 'absolute', bottom: 2, right: 3, fontSize: 9, fontWeight: 700, color: isLight ? '#B45309' : '#FCD34D', opacity: 0.7, lineHeight: 1 }}>
                  {file}
                </span>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S = {
  page: {
    minHeight: '100vh', background: '#080B14', color: '#eaeaea',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '16px 10px 28px', gap: '12px', fontFamily: 'sans-serif'
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
    width: '100%', transition: 'all .2s',
    WebkitTapHighlightColor: 'transparent'
  }),
  sBtn: (active) => ({
    flex: 1, padding: '9px 2px', borderRadius: '8px',
    border: active ? '2px solid #6366F1' : '1px solid #1f2937',
    background: active ? 'rgba(99,102,241,.2)' : 'transparent',
    color: active ? '#A5B4FC' : '#6B7280',
    fontWeight: '700', fontSize: '.85rem', cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent'
  }),
  modeBtn: (active) => ({
    flex: 1, padding: '11px 6px', borderRadius: '10px',
    border: active ? '2px solid #6366F1' : '1px solid #1f2937',
    background: active ? 'rgba(99,102,241,.15)' : 'transparent',
    color: active ? '#A5B4FC' : '#6B7280',
    fontWeight: '700', fontSize: '.82rem', cursor: 'pointer',
    transition: 'all .2s', WebkitTapHighlightColor: 'transparent'
  }),
  diffBtn: (active, col) => ({
    flex: 1, padding: '9px 4px', borderRadius: '8px',
    border: active ? `2px solid ${col}` : '1px solid #1f2937',
    background: active ? `${col}22` : 'transparent',
    color: active ? col : '#6B7280',
    fontWeight: '700', fontSize: '.78rem', cursor: 'pointer',
    transition: 'all .2s', WebkitTapHighlightColor: 'transparent'
  })
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]   = useState('home')
  const [mode, setMode]       = useState('human')
  const [stake, setStake]     = useState(5)
  const [status, setStatus]   = useState('')
  const [loading, setLoading] = useState(false)

  // multiplayer
  const [matchId, setMatchId]   = useState('')
  const [joinId, setJoinId]     = useState('')
  const [color, setColor]       = useState(null)
  const [result, setResult]     = useState(null)
  const [myTurnUI, setMyTurnUI] = useState(false)

  // vs computer
  const [playerColor, setPlayerColor] = useState('white')
  const [difficulty, setDifficulty]   = useState('medium')
  const [botThinking, setBotThinking] = useState(false)
  const [gameOver, setGameOver]       = useState(false)
  const [moveHistory, setMoveHistory] = useState([])
  const [lastMove, setLastMove]       = useState(null)

  // click-to-move
  const [selectedSq, setSelectedSq]     = useState(null)
  const [legalTargets, setLegalTargets] = useState([])

  // single chess instance — we force re-render by bumping a counter
  const chessRef  = useRef(new Chess())
  const [tick, setTick] = useState(0)  // bump to re-render board
  const wsRef     = useRef(null)
  const colorRef  = useRef(null)

  function bump() { setTick(t => t + 1) }

  useEffect(() => { tg?.ready(); tg?.expand() }, [])
/*
  // ─── VS COMPUTER: bot move trigger ────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'game' || mode !== 'computer' || gameOver || botThinking) return
    const chess = chessRef.current
    const botCol = playerColor === 'white' ? 'b' : 'w'
    if (chess.turn() !== botCol || chess.isGameOver()) return

    let cancelled = false
    setBotThinking(true)
    setStatus('🤖 Computer thinking...')

    fetchAIMove(chess.fen(), difficulty).then(uci => {
      if (cancelled) return
      if (!uci) { setBotThinking(false); return }
      const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4] || 'q'
      try {
        const move = chess.move({ from, to, promotion: promo })
        if (move) {
          setLastMove({ from, to })
          setMoveHistory(h => [...h, move.san])
          checkComputerGameOver(chess)
        }
      } catch {}
      setBotThinking(false)
      bump()
      if (!chess.isGameOver()) setStatus('⚡️ Your turn!')
    })
    return () => { cancelled = true }*/
    // ─── VS COMPUTER: bot move trigger ────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'game' || mode !== 'computer' || gameOver) return
    const chess = chessRef.current
    const botCol = playerColor === 'white' ? 'b' : 'w'
    if (chess.turn() !== botCol || chess.isGameOver()) return

    setStatus('🤖 Computer thinking...')

    const timer = setTimeout(() => {
      const uci = getBotMove(chess.fen(), difficulty)
      if (!uci) return
      const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4] || 'q'
      try {
        const move = chess.move({ from, to, promotion: promo })
        if (move) {
          setLastMove({ from, to })
          setMoveHistory(h => [...h, move.san])
          checkComputerGameOver(chess)
          bump()
          if (!chess.isGameOver()) setStatus('⚡️ Your turn!')
        }
      } catch {}
    }, 300)

    return () => clearTimeout(timer)
  }, [tick, screen, mode, gameOver, playerColor, difficulty])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  //}, [tick, screen, mode, gameOver, botThinking])

  function checkComputerGameOver(chess) {
    if (!chess.isGameOver()) return
    setGameOver(true)
    if (chess.isCheckmate()) {
      const winner = chess.turn() === 'w' ? 'black' : 'white'
      setStatus(winner === playerColor ? '🏆 You win! Checkmate!' : '💀 Computer wins!')
    } else {
      setStatus('½ Draw!')
    }
  }

  function startVsComputer() {
    chessRef.current = new Chess()
    setGameOver(false); setBotThinking(false); setMoveHistory([])
    setResult(null); setSelectedSq(null); setLegalTargets([]); setLastMove(null)
    setScreen('game')
    setStatus(playerColor === 'white' ? '⚡️ Your turn!' : '🤖 Computer plays first...')
    bump()
  }

  // ─── SQUARE TAP HANDLER (vs computer) ────────────────────────────────────
  function handleSquareTap(sq) {
    if (gameOver || botThinking) return
    const chess = chessRef.current
    const myCol = playerColor === 'white' ? 'w' : 'b'
    if (chess.turn() !== myCol) return

    // If tapping a legal target → execute move
    if (selectedSq && legalTargets.includes(sq)) {
      let move
      try { move = chess.move({ from: selectedSq, to: sq, promotion: 'q' }) }
      catch { setSelectedSq(null); setLegalTargets([]); return }
      if (!move) { setSelectedSq(null); setLegalTargets([]); return }
      setLastMove({ from: selectedSq, to: sq })
      setMoveHistory(h => [...h, move.san])
      setSelectedSq(null); setLegalTargets([])
      bump()
      checkComputerGameOver(chess)
      return
    }

    // Select a piece
    const piece = chess.get(sq)
    if (piece && piece.color === myCol) {
      const moves = chess.moves({ square: sq, verbose: true })
      setSelectedSq(sq)
      setLegalTargets(moves.map(m => m.to))
    } else {
      setSelectedSq(null); setLegalTargets([])
    }
  }

  // ─── SQUARE TAP HANDLER (multiplayer) ────────────────────────────────────
  function handleMultiSquareTap(sq) {
    if (!myTurnUI || result) return
    const chess = chessRef.current
    const myChessCol = colorRef.current === 'white' ? 'w' : 'b'

    if (selectedSq && legalTargets.includes(sq)) {
      const probe = new Chess(chess.fen())
      let move
      try { move = probe.move({ from: selectedSq, to: sq, promotion: 'q' }) }
      catch { setSelectedSq(null); setLegalTargets([]); return }
      if (!move) { setSelectedSq(null); setLegalTargets([]); return }

      // Optimistic update
      chessRef.current = probe
      setLastMove({ from: selectedSq, to: sq })
      setSelectedSq(null); setLegalTargets([])
      setMyTurnUI(false); setStatus('⏳ Sending move...')
      bump()

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'move', move: selectedSq + sq + (move.promotion || '') }))
      } else {
        setStatus('❌ Not connected'); setMyTurnUI(true)
      }
      return
    }

    const piece = chess.get(sq)
    if (piece && piece.color === myChessCol) {
      const moves = chess.moves({ square: sq, verbose: true })
      setSelectedSq(sq); setLegalTargets(moves.map(m => m.to))
    } else {
      setSelectedSq(null); setLegalTargets([])
    }
  }

  // ─── MULTIPLAYER ──────────────────────────────────────────────────────────
  function applyServerFen(newFen) {
    try { chessRef.current = new Chess(newFen); bump() }
    catch (e) { console.error('Bad FEN', e) }
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

  function reset() {
    if (wsRef.current) wsRef.current.close()
    chessRef.current = new Chess()
    wsRef.current = null; colorRef.current = null
    setScreen('home'); setMyTurnUI(false); setColor(null); setResult(null)
    setMatchId(''); setJoinId(''); setStatus(''); setLoading(false)
    setGameOver(false); setBotThinking(false); setMoveHistory([])
    setSelectedSq(null); setLegalTargets([]); setLastMove(null)
    bump()
  }

  const pool = stake * 2, win = pool * 0.9, fee = pool * 0.1
  const isBot = mode === 'computer'

  // ─── HOME ─────────────────────────────────────────────────────────────────
  if (screen === 'home') return (
    <div style={S.page}>
      <div style={{ fontSize: 52 }}>♟</div>
      <h1 style={{ fontSize: '1.9rem', fontWeight: 900, color: '#818CF8', letterSpacing: '-1px', margin: 0 }}>
        CHESS ARENA
      </h1>
      <p style={{ color: '#6B7280', fontSize: '.8rem', margin: 0 }}>@{tgUser.username || 'Player'}</p>

      <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 440 }}>
        <button onPointerDown={() => setMode('computer')} style={S.modeBtn(mode === 'computer')}>🤖 vs Computer</button>
        <button onPointerDown={() => setMode('human')}    style={S.modeBtn(mode === 'human')}>⚔️ vs Human</button>
      </div>

      {mode === 'computer' && (
        <div style={S.box}>
          <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: 10 }}>PLAY AS</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onPointerDown={() => setPlayerColor('white')} style={S.diffBtn(playerColor === 'white', '#F9FAFB')}>♙ White</button>
            <button onPointerDown={() => setPlayerColor('black')} style={S.diffBtn(playerColor === 'black', '#818CF8')}>♟ Black</button>
          </div>
          <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: 10 }}>DIFFICULTY</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button onPointerDown={() => setDifficulty('easy')}   style={S.diffBtn(difficulty === 'easy',   '#10B981')}>🟢 Easy</button>
            <button onPointerDown={() => setDifficulty('medium')} style={S.diffBtn(difficulty === 'medium', '#F59E0B')}>🟡 Medium</button>
            <button onPointerDown={() => setDifficulty('hard')}   style={S.diffBtn(difficulty === 'hard',   '#EF4444')}>🔴 Hard</button>
          </div>
          {difficulty === 'easy' && (
            <p style={{ color: '#10B981', fontSize: '.7rem', margin: '8px 0 14px' }}>
              💡 Easy shows all possible moves when you tap a piece
            </p>
          )}
          <button onPointerDown={startVsComputer} style={S.btn('linear-gradient(135deg,#6366F1,#8B5CF6)', false)}>
            🤖 Play vs Computer
          </button>
        </div>
      )}

      {mode === 'human' && (
        <>
          <div style={S.box}>
            <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: '10px' }}>SET STAKE (USDT)</p>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
              {[1,5,10,25,50].map(v => (
                <button key={v} onPointerDown={() => setStake(v)} style={S.sBtn(stake === v)}>${v}</button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', textAlign: 'center', background: '#1a2236', borderRadius: '8px', padding: '12px' }}>
              <div><div style={{ color: '#6B7280', fontSize: '.7rem', marginBottom: 3 }}>Pool</div><div style={{ color: '#A5B4FC', fontWeight: 800 }}>${pool.toFixed(2)}</div></div>
              <div><div style={{ color: '#6B7280', fontSize: '.7rem', marginBottom: 3 }}>You Win</div><div style={{ color: '#10B981', fontWeight: 800 }}>${win.toFixed(2)}</div></div>
              <div><div style={{ color: '#6B7280', fontSize: '.7rem', marginBottom: 3 }}>Fee</div><div style={{ color: '#6B7280', fontWeight: 800 }}>${fee.toFixed(2)}</div></div>
            </div>
          </div>
          <button onPointerDown={createMatch} disabled={loading} style={S.btn('linear-gradient(135deg,#6366F1,#8B5CF6)', loading)}>
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
            <button onPointerDown={joinMatch} disabled={loading || !joinId.trim()} style={S.btn('linear-gradient(135deg,#3B82F6,#6366F1)', loading || !joinId.trim())}>
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
        <button onPointerDown={() => { navigator.clipboard.writeText(matchId); setStatus('✅ Copied!') }}
          style={S.btn('linear-gradient(135deg,#3B82F6,#6366F1)', false)}>📋 Copy Match ID</button>
      </div>
      <div style={{ color: '#6B7280', fontSize: '.85rem' }}>⏳ Waiting for opponent...</div>
      {status && <div style={{ color: '#10B981', fontSize: '.85rem' }}>{status}</div>}
      <button onPointerDown={reset} style={{ background: 'transparent', border: '1px solid #1f2937', color: '#6B7280', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer', fontSize: '.85rem' }}>← Cancel</button>
    </div>
  )

  // ─── GAME ─────────────────────────────────────────────────────────────────
  const boardOri   = isBot ? playerColor : (color === 'black' ? 'black' : 'white')
  const humanTurn  = isBot
    ? (!gameOver && !botThinking && chessRef.current.turn() === (playerColor === 'white' ? 'w' : 'b'))
    : (myTurnUI && !result)
  const showHints  = isBot && difficulty === 'easy'

  return (
    <div style={{ ...S.page, padding: '10px 10px 28px', gap: 10 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: 460 }}>
        <div>
          <div style={{ fontWeight: 800, color: '#818CF8', fontSize: '.9rem' }}>♟ CHESS ARENA</div>
          <div style={{ color: '#6B7280', fontSize: '.72rem' }}>
            {isBot
              ? <>You play <strong style={{ color: '#A5B4FC' }}>{playerColor}</strong> · {difficulty}</>
              : <>You are <strong style={{ color: '#A5B4FC' }}>{color}</strong> · ${stake} stake</>
            }
          </div>
        </div>
        <div style={{
          background: botThinking ? 'rgba(245,158,11,.12)' : humanTurn ? 'rgba(16,185,129,.12)' : 'rgba(99,102,241,.12)',
          border: `1px solid ${botThinking ? 'rgba(245,158,11,.4)' : humanTurn ? 'rgba(16,185,129,.4)' : 'rgba(99,102,241,.4)'}`,
          borderRadius: 8, padding: '5px 12px', fontSize: '.75rem', fontWeight: 700,
          color: botThinking ? '#F59E0B' : humanTurn ? '#10B981' : '#A5B4FC'
        }}>
          {botThinking ? '🤖 Thinking' : humanTurn ? '⚡️ Your turn' : '⏳ Waiting'}
        </div>
      </div>

      {/* Status */}
      <div style={{
        background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)',
        borderRadius: 10, padding: '9px 16px', fontSize: '.85rem', fontWeight: 600,
        textAlign: 'center', width: '100%', maxWidth: 460, color: '#A5B4FC', boxSizing: 'border-box'
      }}>
        {status || '♟ Game in progress'}
      </div>

      {/* Custom board */}
      <div style={{ width: 'min(460px, calc(100vw - 20px))' }}>
        <ChessBoard
          chess={chessRef.current}
          orientation={boardOri}
          selectedSq={humanTurn ? selectedSq : null}
          legalTargets={humanTurn ? legalTargets : []}
          onSquareTap={isBot ? handleSquareTap : handleMultiSquareTap}
          showHints={showHints}
          lastMove={lastMove}
        />
      </div>

      {/* Easy mode hint label */}
      {showHints && humanTurn && !gameOver && (
        <div style={{ color: '#10B981', fontSize: '.72rem', textAlign: 'center', opacity: 0.85 }}>
          💡 Tap any piece to see where it can move
        </div>
      )}

      {/* Move history */}
      {isBot && moveHistory.length > 0 && (
        <div style={{ ...S.box, maxHeight: 68, overflowY: 'auto', padding: '10px 14px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {moveHistory.map((m, i) => (
              <span key={i} style={{
                background: i % 2 === 0 ? 'rgba(255,255,255,.06)' : 'rgba(99,102,241,.12)',
                color: i % 2 === 0 ? '#9CA3AF' : '#A5B4FC',
                padding: '2px 7px', borderRadius: 4, fontSize: '.72rem', fontWeight: 600
              }}>
                {i % 2 === 0 ? `${Math.floor(i/2)+1}.` : ''}{m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Prize bar */}
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
          <button onPointerDown={isBot ? startVsComputer : reset}
            style={{ ...S.btn('linear-gradient(135deg,#6366F1,#8B5CF6)', false), flex: 1 }}>
            🔄 Play Again
          </button>
        )}
        <button onPointerDown={reset}
          style={{ flex: result || gameOver ? '0 0 auto' : 1, padding: '13px 20px', background: 'transparent', border: '1px solid #1f2937', color: '#6B7280', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '.85rem', WebkitTapHighlightColor: 'transparent' }}>
          ← Home
        </button>
      </div>
    </div>
  )
}
