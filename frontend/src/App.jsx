import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Chess } from 'chess.js'

const API = 'https://chess-bot-production-efa2.up.railway.app'
const WSS = 'wss://chess-bot-production-efa2.up.railway.app'
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
// ─── CURRENCY CONFIG ──────────────────────────────────────────────────────────
// Stakes, symbols, and decimals per currency.
// All financial validation happens SERVER-SIDE — this is display config only.
const CURRENCY_CONFIG = {
  USDT: {
    symbol: '$',
    unit: 'USDT',
    icon: '💵',
    stakes: [0, 1, 5, 10, 25, 50],
    decimals: 2,
    color: '#26A17B',        // Tether green
    description: 'Tether USD — stable, pegged 1:1 to US Dollar'
  },
  TON: {
    symbol: '◎',
    unit: 'TON',
    icon: '💎',
    stakes: [0, 0.5, 1, 2, 5, 10],
    decimals: 2,
    color: '#0088CC',        // TON blue
    description: 'The Open Network — Telegram\'s native blockchain'
  },
  STARS: {
    symbol: '★',
    unit: 'Stars',
    icon: '⭐',
    stakes: [0, 50, 100, 250, 500, 1000],
    decimals: 0,
    color: '#F59E0B',        // Gold
    description: 'Telegram Stars — buy directly inside Telegram'
  }
}

const tg = window.Telegram?.WebApp
const tgUser = tg?.initDataUnsafe?.user || { id: 0, username: 'Player' }

// ─── PIECE UNICODE ────────────────────────────────────────────────────────────
const PIECES = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
}

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

// ─── BOT MOVE ENGINE — reliable setTimeout, works in all WebViews ─────────────
// Web Workers with importScripts are blocked in Telegram WebView on many devices.
// This runs on the main thread inside a setTimeout so the UI can update first,
// then the engine runs. For depth-2/3 minimax this takes 50-200ms — imperceptible.
function fetchAIMove(fen, difficulty) {
  return new Promise(resolve => {
    setTimeout(() => {
      try {
        const chess = new Chess(fen)
        const moves = chess.moves({ verbose: true })
        if (!moves.length) return resolve(null)

        // Easy — random legal move, instant
        if (difficulty === 'easy') {
          const m = moves[Math.floor(Math.random() * moves.length)]
          return resolve(m.from + m.to + (m.promotion || ''))
        }

        // Shuffle moves for variety before searching
        for (let i = moves.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [moves[i], moves[j]] = [moves[j], moves[i]]
        }

        const depth = difficulty === 'hard' ? 3 : 2
        const isMax = chess.turn() === 'w'
        let bestScore = isMax ? -Infinity : Infinity
        let bestMove = moves[0]

        for (const move of moves) {
          chess.move(move)
          const score = minimax(chess, depth - 1, -Infinity, Infinity, !isMax)
          chess.undo()
          if (isMax ? score > bestScore : score < bestScore) {
            bestScore = score
            bestMove = move
          }
        }

        resolve(bestMove.from + bestMove.to + (bestMove.promotion || ''))
      } catch {
        resolve(null)
      }
    }, 80) // 80ms delay — lets React render "thinking..." before engine starts
  })
}

// ─── SOUND ENGINE (Web Audio API — no libraries needed) ──────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext
function createSoundEngine() {
  let ctx = null

  function getCtx() {
    if (!AudioCtx) return null
    if (!ctx) ctx = new AudioCtx()
    // Resume if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
}

  function playTone({ type = 'sine', freq, freq2, duration, volume = 0.4, attack = 0.01, decay = 0.1, fadeStart, notes }) {
    const c = getCtx()
    const now = c.currentTime

    // If notes array given, play each note sequentially
    if (notes) {
      notes.forEach(n => playTone(n))
      return
    }

    const osc  = c.createOscillator()
    const gain = c.createGain()
    osc.connect(gain)
    gain.connect(c.destination)

    osc.type = type
    osc.frequency.setValueAtTime(freq, now)
    if (freq2) osc.frequency.exponentialRampToValueAtTime(freq2, now + duration * 0.5)

    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(volume, now + attack)
    if (fadeStart != null) {
      gain.gain.setValueAtTime(volume, now + fadeStart)
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration)
    } else {
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration)
    }

    osc.start(now)
    osc.stop(now + duration)
  }

  return {
    // Soft woody thud — piece placed on board
    move() {
      playTone({ type: 'triangle', freq: 180, freq2: 90, duration: 0.18, volume: 0.5, attack: 0.005 })
    },

    // Harder crack — piece taken
    capture() {
      playTone({ type: 'sawtooth', freq: 260, freq2: 80, duration: 0.22, volume: 0.45, attack: 0.005 })
      setTimeout(() => playTone({ type: 'triangle', freq: 120, duration: 0.15, volume: 0.3 }), 60)
    },

    // Tense two-tone pulse — king is in check
    check() {
      playTone({ notes: [
        { type: 'square', freq: 440, duration: 0.12, volume: 0.3, attack: 0.01 },
        { type: 'square', freq: 554, duration: 0.12, volume: 0.3, attack: 0.01, fadeStart: 0.08 }
      ]})
      setTimeout(() => playTone({ type: 'square', freq: 554, duration: 0.14, volume: 0.3 }), 160)
    },

    // Castling — double knock
    castle() {
      playTone({ type: 'triangle', freq: 200, freq2: 110, duration: 0.16, volume: 0.45, attack: 0.005 })
      setTimeout(() => playTone({ type: 'triangle', freq: 160, freq2: 90, duration: 0.16, volume: 0.35, attack: 0.005 }), 120)
    },

    // Rising arpeggio — game start
    gameStart() {
      const notes = [261, 329, 392, 523]
      notes.forEach((f, i) => {
        setTimeout(() => playTone({ type: 'sine', freq: f, duration: 0.25, volume: 0.3, attack: 0.02 }), i * 120)
      })
    },

    // Triumphant fanfare — you win
    win() {
      const seq = [
        { freq: 392, dur: 120 }, { freq: 392, dur: 120 }, { freq: 392, dur: 120 },
        { freq: 523, dur: 400 }, { freq: 440, dur: 200 }, { freq: 523, dur: 500 }
      ]
      let t = 0
      seq.forEach(({ freq, dur }) => {
        setTimeout(() => playTone({ type: 'sine', freq, duration: dur / 1000 + 0.05, volume: 0.35, attack: 0.02 }), t)
        t += dur + 20
      })
    },

    // Descending sad tones — you lose
    lose() {
      const seq = [{ freq: 330, dur: 200 }, { freq: 277, dur: 200 }, { freq: 220, dur: 400 }]
      let t = 0
      seq.forEach(({ freq, dur }) => {
        setTimeout(() => playTone({ type: 'sine', freq, duration: dur / 1000 + 0.05, volume: 0.28, attack: 0.02 }), t)
        t += dur + 20
      })
    },

    // Neutral chord — draw
    draw() {
      playTone({ type: 'sine', freq: 330, duration: 0.5, volume: 0.25, attack: 0.04 })
      playTone({ type: 'sine', freq: 392, duration: 0.5, volume: 0.2,  attack: 0.04 })
    },

    // Soft click — UI button press
    click() {
      playTone({ type: 'sine', freq: 600, freq2: 400, duration: 0.08, volume: 0.2, attack: 0.005 })
    }
  }
}

// Single instance — created lazily on first user interaction
let _sfx = null
function sfx() {
  if (!_sfx) _sfx = createSoundEngine()
  return _sfx
}

// Helper — call after chess.move() to auto-pick the right sound
function playSoundForMove(move, chess) {
  if (!move) return
  if (chess.isCheckmate())      { sfx().win(); return }   // handled by game-over logic separately
  if (chess.isCheck())          { sfx().check(); return }
  if (move.flags.includes('k') || move.flags.includes('q')) { sfx().castle(); return }
  if (move.captured)            { sfx().capture(); return }
  sfx().move()
}
// ─── CUSTOM CHESS BOARD ───────────────────────────────────────────────────────
const ChessBoard = React.memo(function ChessBoard({ chess, orientation, selectedSq, legalTargets, onSquareTap, showHints, lastMove, checkedKingSq }) {
  const files = ['a','b','c','d','e','f','g','h']
  const ranks = ['8','7','6','5','4','3','2','1']

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
          const isCheckedKing = sq === checkedKingSq
          const hasPiece = !!piece

          // Square background — priority: selected > check > last move > normal
          let bg = isLight ? '#FCD34D' : '#B45309'
          if (isSelected)              bg = '#6366F1'
          else if (isCheckedKing)      bg = '#EF4444'
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
                    <div style={{
                      width: '90%', height: '90%',
                      borderRadius: '50%',
                      border: showHints ? '4px solid rgba(16,185,129,0.85)' : '3px solid rgba(255,255,255,0.4)',
                      boxSizing: 'border-box'
                    }} />
                  ) : (
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
                  fontSize: 'clamp(20px, 6vw, 42px)',
                  lineHeight: 1,
                  zIndex: 3,
                  filter: isSelected
                    ? 'brightness(1.4) drop-shadow(0 0 6px rgba(255,255,255,0.8))'
                    : isCheckedKing
                    ? 'drop-shadow(0 0 8px rgba(239,68,68,0.9))'
                    : 'drop-shadow(1px 1px 1px rgba(0,0,0,0.5))',
                  transition: 'filter 0.1s'
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
}, (prev, next) => {
  // Custom comparator — only re-render when chess-relevant props actually changed.
  // This stops the entire 64-square board re-rendering on every unrelated state update.
  return (
    prev.chess.fen()           === next.chess.fen()        &&
    prev.selectedSq            === next.selectedSq         &&
    prev.checkedKingSq         === next.checkedKingSq      &&
    prev.lastMove?.from        === next.lastMove?.from     &&
    prev.lastMove?.to          === next.lastMove?.to       &&
    prev.legalTargets.join()   === next.legalTargets.join() &&
    prev.orientation           === next.orientation        &&
    prev.showHints             === next.showHints
  )
})

// ─── PROFILE SCREEN ───────────────────────────────────────────────────────────
function ProfileScreen({ onBack }) {
  const [profile, setProfile]   = useState(null)
  const [txns, setTxns]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState('overview')   // 'overview' | 'history'
  const [error, setError]       = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [meRes, txRes] = await Promise.all([
          fetch(API + '/api/me',           { headers: { 'x-init-data': 'test' } }),
          fetch(API + '/api/transactions', { headers: { 'x-init-data': 'test' } })
        ])
        if (meRes.ok)  setProfile(await meRes.json())
        if (txRes.ok)  setTxns((await txRes.json()).transactions || [])
      } catch { setError('Could not load profile. Check connection.') }
      setLoading(false)
    }
    load()
  }, [])

  const avatarLetter = (tgUser.username || tgUser.first_name || 'P')[0].toUpperCase()
  const playable  = parseFloat(profile?.playable_balance  || 0)
  const locked    = parseFloat(profile?.locked_balance    || 0)
  const total     = playable + locked

  // Derive win/loss/draw counts from transaction history
  const wins   = txns.filter(t => t.type === 'winnings').length
  const losses = txns.filter(t => t.type === 'rake' || t.type === 'loss').length
  const totalGames = wins + losses

  // Type → display config
  function txMeta(type) {
    if (type === 'deposit')  return { label: 'Deposit',   color: '#10B981', sign: '+', icon: '⬇️' }
    if (type === 'withdraw') return { label: 'Withdraw',  color: '#EF4444', sign: '-', icon: '⬆️' }
    if (type === 'winnings') return { label: 'Winnings',  color: '#10B981', sign: '+', icon: '🏆' }
    if (type === 'stake')    return { label: 'Stake',     color: '#F59E0B', sign: '-', icon: '🎯' }
    if (type === 'refund')   return { label: 'Refund',    color: '#6366F1', sign: '+', icon: '↩️' }
    if (type === 'rake')     return { label: 'Fee',       color: '#6B7280', sign: '-', icon: '💸' }
    return                          { label: type,        color: '#9CA3AF', sign: '',  icon: '•'  }
  }

  function formatDate(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
      + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  const tabStyle = (active) => ({
    flex: 1, padding: '9px 4px', borderRadius: 8, border: 'none',
    background: active ? 'rgba(99,102,241,.2)' : 'transparent',
    color: active ? '#A5B4FC' : '#4B5563',
    fontWeight: 700, fontSize: '.82rem', cursor: 'pointer',
    borderBottom: active ? '2px solid #6366F1' : '2px solid transparent',
    WebkitTapHighlightColor: 'transparent', transition: 'all .15s'
  })

  return (
    <div className="text-white flex justify-center items-center min-h-screen p-0 sm:p-4 bg-[#03010a] font-sans">
      <div className="w-full max-w-md bg-[#0a0516] h-screen sm:h-[850px] flex flex-col justify-between shadow-[0_0_50px_rgba(139,92,246,0.15)] relative overflow-hidden border-x border-slate-900 sm:rounded-3xl">
        
        {/* ── Top header bar ── */}
        <header className="px-4 pt-3 pb-2 bg-[#0e071f] flex justify-between items-center border-b border-[#1b1233] shrink-0 z-50">
          <button onPointerDown={onBack} className="text-gray-400 hover:text-white transition">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          </button>
          <div className="font-bold text-base tracking-wide bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-purple-300">My Account</div>
          <div className="w-6" />
        </header>

        {/* Scrollable content */}
        <div className="flex-grow overflow-y-auto no-scrollbar p-3 space-y-4 bg-[#080B14] pb-8">
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '60px 20px', color: '#4B5563' }}>
              <div style={{ fontSize: 32, animation: 'spin 1s linear infinite' }}>⟳</div>
              <div style={{ fontSize: '.85rem' }}>Loading your profile...</div>
            </div>
          )}

          {error && (
            <div style={{ margin: '20px 16px', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '12px 16px', color: '#FCA5A5', fontSize: '.85rem', textAlign: 'center' }}>
              {error}
            </div>
          )}

          {!loading && !error && (
            <>
              {/* ── Avatar + identity card ── */}
              <div style={{ background: 'linear-gradient(135deg,#111827,#1a2236)', border: '1px solid rgba(99,102,241,.2)', borderRadius: 16, padding: '20px 20px 16px', position: 'relative', overflow: 'hidden' }}>
                {/* Glow blob */}
                <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, background: 'rgba(99,102,241,.12)', borderRadius: '50%', filter: 'blur(30px)', pointerEvents: 'none' }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {/* Avatar circle */}
                  <div style={{ width: 58, height: 58, borderRadius: '50%', background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', display: 'flex', alignItems: 'center', justifycontent: 'center', fontSize: '1.5rem', fontWeight: 900, color: '#fff', flexShrink: 0, boxShadow: '0 0 0 3px rgba(99,102,241,.3)' }}>
                    {avatarLetter}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#eaeaea', whiteSpace: 'nowrap', overflow: 'hidden', textoverflow: 'ellipsis' }}>
                      @{tgUser.username || tgUser.first_name || 'Player'}
                    </div>
                    <div style={{ color: '#4B5563', fontSize: '.75rem', marginTop: 2 }}>
                      Telegram ID: <span style={{ color: '#6366F1', fontFamily: 'monospace' }}>{tgUser.id || '—'}</span>
                    </div>
                    <div style={{ display: 'inline-block', marginTop: 6, background: profile?.status === 'active' ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.15)', border: `1px solid ${profile?.status === 'active' ? 'rgba(16,185,129,.4)' : 'rgba(239,68,68,.4)'}`, borderRadius: 20, padding: '2px 10px', fontSize: '.68rem', fontWeight: 700, color: profile?.status === 'active' ? '#10B981' : '#EF4444', letterSpacing: '.5px' }}>
                      {(profile?.status || 'active').toUpperCase()}
                    </div>
                  </div>
                </div>

                {/* Total balance hero */}
                <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,.05)' }}>
                  <div style={{ color: '#4B5563', fontSize: '.7rem', fontWeight: 700, letterSpacing: '1px', marginBottom: 4 }}>TOTAL BALANCE</div>
                  <div style={{ fontSize: '2rem', fontWeight: 900, color: '#A5B4FC', letterSpacing: '-1px' }}>
                    ${total.toFixed(2)} <span style={{ fontSize: '.9rem', color: '#6366F1', fontWeight: 700 }}>USDT</span>
                  </div>
                </div>
              </div>

              {/* ── Balance breakdown cards ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ background: '#111827', border: '1px solid rgba(16,185,129,.2)', borderRadius: 12, padding: '14px' }}>
                  <div style={{ color: '#4B5563', fontSize: '.68rem', fontWeight: 700, letterSpacing: '.8px', marginBottom: 6 }}>AVAILABLE</div>
                  <div style={{ color: '#10B981', fontSize: '1.2rem', fontWeight: 800 }}>${playable.toFixed(2)}</div>
                  <div style={{ color: '#374151', fontSize: '.68rem', marginTop: 3 }}>Ready to play</div>
                </div>
                <div style={{ background: '#111827', border: '1px solid rgba(245,158,11,.2)', borderRadius: 12, padding: '14px' }}>
                  <div style={{ color: '#4B5563', fontSize: '.68rem', fontWeight: 700, letterSpacing: '.8px', marginBottom: 6 }}>IN ESCROW</div>
                  <div style={{ color: '#F59E0B', fontSize: '1.2rem', fontWeight: 800 }}>${locked.toFixed(2)}</div>
                  <div style={{ color: '#374151', fontSize: '.68rem', marginTop: 3 }}>Active match</div>
                </div>
              </div>

              {/* ── Stats row ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {[
                  { label: 'GAMES',  value: totalGames, color: '#A5B4FC' },
                  { label: 'WINS',   value: wins,        color: '#10B981' },
                  { label: 'LOSSES', value: losses,      color: '#EF4444' },
                ].map(s => (
                  <div key={s.label} style={{ background: '#111827', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12, padding: '12px 10px', textAlign: 'center' }}>
                    <div style={{ color: s.color, fontSize: '1.3rem', fontWeight: 900 }}>{s.value}</div>
                    <div style={{ color: '#4B5563', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.8px', marginTop: 3 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* ── Deposit / Withdraw action buttons ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button onPointerDown={() => alert('Deposit flow coming soon.\nSend USDT to your wallet address and contact support.')}
                  style={{ background: 'linear-gradient(135deg,#10B981,#059669)', border: 'none', borderRadius: 12, padding: '13px', color: '#fff', fontWeight: 800, fontSize: '.9rem', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                  ⬇️ Deposit
                </button>
                <button onPointerDown={() => alert('Withdraw flow coming soon.\nMinimum withdrawal: $5 USDT.')}
                  style={{ background: playable >= 5 ? 'linear-gradient(135deg,#6366F1,#8B5CF6)' : '#1f2937', border: 'none', borderRadius: 12, padding: '13px', color: playable >= 5 ? '#fff' : '#4B5563', fontWeight: 800, fontSize: '.9rem', cursor: playable >= 5 ? 'pointer' : 'not-allowed', WebkitTapHighlightColor: 'transparent' }}>
                  ⬆️ Withdraw
                </button>
              </div>
              <div style={{ color: '#374151', fontSize: '.7rem', textAlign: 'center' }}>
                Minimum withdrawal: $5.00 USDT · 10% platform fee on winnings
              </div>

              {/* ── Tab switcher ── */}
              <div style={{ display: 'flex', gap: 4, background: '#0d1117', borderRadius: 10, padding: 4 }}>
                <button onPointerDown={() => setTab('overview')} style={tabStyle(tab === 'overview')}>📊 Overview</button>
                <button onPointerDown={() => setTab('history')}  style={tabStyle(tab === 'history')}>📋 History ({txns.length})</button>
              </div>

              {/* ── Overview tab ── */}
              {tab === 'overview' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Win rate bar */}
                  <div style={{ background: '#111827', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12, padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ color: '#6B7280', fontSize: '.75rem', fontWeight: 700 }}>WIN RATE</span>
                      <span style={{ color: '#A5B4FC', fontSize: '.75rem', fontWeight: 800 }}>
                        {totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0}%
                      </span>
                    </div>
                    <div style={{ height: 8, background: '#1f2937', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${totalGames > 0 ? (wins / totalGames) * 100 : 0}%`, background: 'linear-gradient(90deg,#10B981,#34D399)', borderRadius: 99, transition: 'width .6s ease' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                      <span style={{ color: '#10B981', fontSize: '.68rem' }}>{wins} wins</span>
                      <span style={{ color: '#EF4444', fontSize: '.68rem' }}>{losses} losses</span>
                    </div>
                  </div>

                  {/* Account info rows */}
                  {[
                    { label: 'Account ID',   value: profile?.id ? profile.id.slice(0,8) + '...' : '—', mono: true },
                    { label: 'Telegram ID',  value: tgUser.id || '—', mono: true },
                    { label: 'Username',     value: '@' + (tgUser.username || tgUser.first_name || 'Player'), mono: false },
                    { label: 'Status',       value: (profile?.status || 'active').toUpperCase(), mono: false },
                  ].map(row => (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111827', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10, padding: '12px 14px' }}>
                      <span style={{ color: '#6B7280', fontSize: '.8rem' }}>{row.label}</span>
                      <span style={{ color: '#A5B4FC', fontSize: '.8rem', fontWeight: 700, fontFamily: row.mono ? 'monospace' : 'inherit' }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── History tab ── */}
              {tab === 'history' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {txns.length === 0 && (
                    <div style={{ textAlign: 'center', color: '#4B5563', padding: '40px 0', fontSize: '.85rem' }}>
                      No transactions yet.<br />Play a match to see your history here.
                    </div>
                  )}
                  {txns.map((t, i) => {
                    const m = txMeta(t.type)
                    return (
                      <div key={t.id || i} style={{ background: '#111827', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                        {/* Icon */}
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: `${m.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>
                          {m.icon}
                        </div>
                        {/* Label + date */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '.82rem', color: '#eaeaea' }}>{m.label}</div>
                          <div style={{ color: '#4B5563', fontSize: '.68rem', marginTop: 1 }}>{formatDate(t.created_at)}</div>
                        </div>
                        {/* Amount */}
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: '.9rem', color: m.color }}>
                            {m.sign}${parseFloat(t.amount || 0).toFixed(2)}
                          </div>
                          <div style={{ fontSize: '.65rem', color: t.status === 'completed' ? '#10B981' : '#F59E0B', marginTop: 1, fontWeight: 700 }}>
                            {(t.status || 'pending').toUpperCase()}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <footer className="bg-[#0b0617] border-t border-[#231545] grid grid-cols-5 text-center py-3 text-gray-300 text-xs font-black shrink-0 z-40 shadow-[0_-8px_25px_rgba(139,92,246,0.15)]">
          <button onPointerDown={onBack} className="hover:text-gray-150 flex flex-col items-center justify-center gap-1 transition duration-100">
            <span className="text-lg">🏠</span> 
            <span>Home</span>
          </button>
          <button onPointerDown={() => alert('Leaderboard is displayed below on the home page.')} className="hover:text-gray-150 flex flex-col items-center justify-center gap-1 transition duration-150">
            <span className="text-lg">🏆</span>
            <span>Rank</span>
          </button>
          <button className="text-purple-200 flex flex-col items-center justify-center gap-1 drop-shadow-[0_0_12px_rgba(168,85,247,0.75)]">
            <span className="text-lg">📜</span>
            <span>History</span>
          </button>
          <button onPointerDown={() => alert('Support Chat coming soon.')} className="hover:text-gray-150 flex flex-col items-center justify-center gap-1 transition duration-100">
            <span className="text-lg">💬</span>
            <span>Chat</span>
          </button>
          <button onPointerDown={onBack} className="hover:text-gray-150 flex flex-col items-center justify-center gap-1 transition duration-100">
            <span className="text-lg">👤</span>
            <span>Me</span>
          </button>
        </footer>

      </div>
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
  const helpFromRef           = useRef('home')
  const [mode, setMode]       = useState('human')
  const [currency, setCurrency]   = useState('USDT')
  const [stake, setStake]         = useState(5)
  const [userBalance, setUserBalance] = useState(null)
  const [status, setStatus]   = useState('')
  const [loading, setLoading] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [betPanelOpen, setBetPanelOpen] = useState(false)

  // multiplayer
  const [matchId, setMatchId]   = useState('')
  const [joinId, setJoinId]     = useState('')
  const [color, setColor]       = useState(null)
  const [result, setResult]     = useState(null)
  const [myTurnUI, setMyTurnUI] = useState(false)

// matchmaking queue
  const [inQueue, setInQueue]         = useState(false)
  const [queueSeconds, setQueueSeconds] = useState(0)
  const queueTimerRef                 = useRef(null)
  const queueWsRef                    = useRef(null)

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

  // Step 1: Mode Select
  const handleSelectMode = (selectedMode) => {
    setMode(selectedMode)
    setCurrentStep(1)
    setStake(selectedMode === 'computer' ? 0 : 5)
    setBetPanelOpen(false)
    setStatus('')
  }

  // Step 2: Style Select ('free' or 'bet')
  const handleSelectStyle = (styleType) => {
    if (currentStep < 1) {
      setStatus('⚠️ First choice who u wanna play with!')
      return
    }
    if (mode === 'computer' && styleType === 'bet') {
      setStatus("❌ Play With Bet is unacceptable against AI mode! Choose 'Play For Free'.")
      return
    }

    if (styleType === 'free') {
      setStake(0)
      setCurrentStep(2)
      setBetPanelOpen(false)
      setStatus('')
    } else {
      setBetPanelOpen(true)
      setStatus('')
    }
  }

  // Confirm Stake Amount
  const handleConfirmStake = (amount) => {
    setStake(amount)
    setCurrentStep(2)
    setStatus('')
  }

  // ─── AUTO-REGISTER: runs once on load ─────────────────────────────────────
  // Calls /api/me — backend creates user row if first visit, returns profile if existing.
  // Silent — user never sees a "sign up" screen.
  useEffect(() => {
    tg?.ready(); tg?.expand()
    const initData = tg?.initData || 'test'
    fetch(API + '/api/me', { headers: { 'x-init-data': initData } })
      .then(r => r.json())
      .then(data => {
                if (data?.balance?.playable !== undefined) {
          setUserBalance(data.balance.playable)
        }
      })
      .catch(() => {}) // Silent fail — app still works, just no balance shown
  }, [])
  // ─── VS COMPUTER: bot move trigger ────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'game' || mode !== 'computer' || gameOver) return
    const chess = chessRef.current
    const botCol = playerColor === 'white' ? 'b' : 'w'
    if (chess.turn() !== botCol || chess.isGameOver()) return

    setBotThinking(true)
    setStatus('🤖 Computer thinking...')

    const timer = setTimeout(() => {
      fetchAIMove(chess.fen(), difficulty).then(uci => {
        if (!uci) { setBotThinking(false); return }
        const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4] || 'q'
        try {
         const move = chess.move({ from, to, promotion: promo })
        if (move) {
          playSoundForMove(move, chess)
          setLastMove({ from, to })
          setMoveHistory(h => [...h, move.san])
          checkComputerGameOver(chess)
          bump()
          if (!chess.isGameOver()) setStatus('⚡️ Your turn!')
          }
        } catch {}
        setBotThinking(false)
      })
    }, 300)

    return () => clearTimeout(timer)
  }, [tick, screen, mode, gameOver, playerColor, difficulty])

  function checkComputerGameOver(chess) {
    if (!chess.isGameOver()) return
    setGameOver(true)
    if (chess.isCheckmate()) {
      const winner = chess.turn() === 'w' ? 'black' : 'white'
      if (winner === playerColor) { sfx().win(); setStatus('🏆 You win! Checkmate!') }
      else                        { sfx().lose(); setStatus('💀 Computer wins!') }
    } else {
      sfx().draw()
      setStatus('½ Draw!')
    }
  }

function startVsComputer() {
    chessRef.current = new Chess()
    setGameOver(false); setBotThinking(false); setMoveHistory([])
    setResult(null); setSelectedSq(null); setLegalTargets([]); setLastMove(null)
    setScreen('game')
    setStatus(playerColor === 'white' ? '⚡️ Your turn!' : '🤖 Computer plays first...')
    sfx().gameStart()
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
      playSoundForMove(move, chess)
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
      playSoundForMove(move, probe)
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
        body: JSON.stringify({ stake, currency })
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

// ─── MATCHMAKING QUEUE ────────────────────────────────────────────────────
  function findMatch() {
    setInQueue(true); setQueueSeconds(0); setStatus('🔍 Finding opponent...')
    setScreen('queue')

    // Timer — counts seconds while searching
    queueTimerRef.current = setInterval(() => setQueueSeconds(s => s + 1), 1000)

    const initData = tg?.initData || 'test'
    // WebSocket to matchmaking endpoint — server notifies when paired
    const ws = new WebSocket(`${WSS}/ws/queue/${stake}/${currency.toUpperCase()}?init=${encodeURIComponent(initData)}`)
    queueWsRef.current = ws

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data)
      if (msg.type === 'matched') {
        // Server found us an opponent — jump straight into the game
        clearInterval(queueTimerRef.current)
        setInQueue(false)
        colorRef.current = msg.color; setColor(msg.color)
        setMatchId(msg.match_id)
        setScreen('game')
        connect(msg.match_id, msg.color)
        setStatus(msg.color === 'white' ? '⚡️ Your turn!' : '⏳ Opponent goes first...')
      }
      if (msg.type === 'waiting') {
        setStatus(`🔍 Searching... ${msg.in_queue} player(s) in queue`)
      }
      if (msg.type === 'timeout') {
        cancelQueue()
        setStatus('⏱ No opponent found. Try again.')
        setScreen('home')
      }
    }
    ws.onclose = () => {
      if (inQueue) { cancelQueue(); setScreen('home') }
    }
    ws.onerror = () => {
      cancelQueue(); setStatus('❌ Queue error. Try again.'); setScreen('home')
    }
  }

  function cancelQueue() {
    clearInterval(queueTimerRef.current)
    if (queueWsRef.current) { queueWsRef.current.close(); queueWsRef.current = null }
    setInQueue(false); setQueueSeconds(0)
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
        if (msg.last_move) setLastMove({ from: msg.last_move.slice(0,2), to: msg.last_move.slice(2,4) })
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
    else if (r.winner === clr) setStatus(`🏆 YOU WIN! +${cfg.symbol}${(stake * 2 * 0.9).toFixed(cfg.decimals)} ${cfg.unit}`)
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

  const cfg  = CURRENCY_CONFIG[currency]
  const pool = stake * 2, win = pool * 0.9, fee = pool * 0.1
  const isBot = mode === 'computer'

  // ─── CHECK HIGHLIGHTING ───────────────────────────────────────────────────
  // Find the king square of whoever is in check, so ChessBoard can flash it red.
  // Derived from chessRef — safe read-only, no mutations.
  function getCheckedKingSq() {
    const chess = chessRef.current
    if (!chess.isCheck()) return null
    const turn = chess.turn()   // the side currently in check
    for (const rank of ['1','2','3','4','5','6','7','8']) {
      for (const file of ['a','b','c','d','e','f','g','h']) {
        const sq = file + rank
        const p = chess.get(sq)
        if (p && p.type === 'k' && p.color === turn) return sq
      }
    }
    return null
  }
  const checkedKingSq = (screen === 'game') ? getCheckedKingSq() : null

  // ─── DYNAMIC NOTIFICATION BANNERS ──────────────────────────────────────────
  let notificationText = '👉 Step 1: Choose who you want to play with below!'
  let notificationClass = 'text-amber-400 bg-amber-500/10 border-amber-500/20'

  if (status && (status.startsWith('⚠️') || status.startsWith('❌'))) {
    notificationText = status
    notificationClass = 'text-red-400 bg-red-500/10 border-red-500/30 font-black shadow-[0_0_15px_rgba(239,68,68,0.15)]'
  } else if (currentStep === 0) {
    notificationText = '👉 Step 1: Choose who you want to play with below!'
    notificationClass = 'text-amber-400 bg-amber-500/10 border-amber-500/20 shadow-[0_0_12px_rgba(245,158,11,0.05)]'
  } else if (currentStep === 1) {
    if (mode === 'computer') {
      notificationText = "👉 Step 2: Betting unavailable vs AI. Tap 'Play For Free' to continue!"
      notificationClass = 'text-blue-400 bg-blue-500/10 border-blue-500/20 shadow-[0_0_10px_rgba(59,130,246,0.1)]'
    } else {
      notificationText = "👉 Step 2: Choose 'Play With Bet' or 'Play For Free'!"
      notificationClass = 'text-purple-400 bg-purple-500/10 border-purple-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]'
    }
  } else if (currentStep === 2) {
    const modeLabel = mode === 'computer' ? 'VS AI' : 'VS HUMAN'
    const stakeLabel = stake === 0 ? 'FREE' : `${cfg.symbol}${stake}`
    const promptTarget = mode === 'computer' ? 'an AI Difficulty Level' : 'Find/Create Match'
    notificationText = `✅ Setup Ready (${modeLabel} - ${stakeLabel})! Now choose ${promptTarget} below.`
    notificationClass = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
  }

  // ─── RENDERING HELPERS ─────────────────────────────────────────────────────
  function renderHome() {
    return (
      <main className="p-3 space-y-4 flex-grow overflow-y-auto no-scrollbar">
        {/* Step 1 Profile & Balance Grid */}
        <div className="space-y-1">
          <div className="grid grid-cols-4 gap-1.5 text-[10px] text-center font-semibold">
            <div 
              onPointerDown={() => setScreen('profile')} 
              className="bg-[#140b29] border border-[#231742] py-2 rounded-xl flex flex-col items-center justify-center gap-0.5 hover:border-purple-500/40 transition cursor-pointer"
            >
              <span className="text-purple-400 text-sm drop-shadow-[0_0_5px_rgba(168,85,247,0.4)]">👤+</span>
              <span className="text-gray-300 text-[9px]">Profile</span>
            </div>
            <div className="bg-[#140b29] border border-[#231742] py-2 rounded-xl flex flex-col items-center justify-center">
              <span className="text-emerald-400 text-[11px] drop-shadow-[0_0_5px_rgba(52,211,153,0.3)]">🖨️ Balance</span>
              <span className="text-[#26d07c] font-black text-[9px]">
                {userBalance !== null ? `$${userBalance.toFixed(2)}` : '$0.00'}
              </span>
            </div>
            <div 
              onPointerDown={() => { helpFromRef.current = 'home'; setScreen('help') }}
              className="bg-[#140b29] border border-[#231742] py-2 rounded-xl flex flex-col items-center justify-center gap-0.5 hover:border-purple-500/40 transition cursor-pointer"
            >
              <span className="text-purple-400 text-sm drop-shadow-[0_0_5px_rgba(168,85,247,0.4)]">🎁</span>
              <span className="text-gray-300 text-[9px]">Promotions</span>
            </div>
            <div 
              onPointerDown={() => alert('Invite Friends: Coming Soon!')} 
              className="bg-[#140b29] border border-[#231742] py-2 rounded-xl flex flex-col items-center justify-center gap-0.5 hover:border-purple-500/40 transition cursor-pointer"
            >
              <span className="text-purple-400 text-sm drop-shadow-[0_0_5px_rgba(168,85,247,0.4)]">👥+</span>
              <span className="text-gray-300 text-[9px]">Invite Friends</span>
            </div>
          </div>
        </div>

        {/* Hero Section */}
        <section className="relative bg-gradient-to-b from-[#1f1047] via-[#100727] to-[#0a0516] rounded-2xl p-5 border border-[#482e99]/60 overflow-hidden text-center flex flex-col items-center justify-center min-h-[165px] shadow-[0_0_25px_rgba(139,92,246,0.25)]">
          <div className="absolute -right-6 -top-6 w-28 h-28 bg-purple-500/10 rounded-full blur-2xl pointer-events-none"></div>
          <div className="absolute -left-6 -bottom-6 w-28 h-28 bg-blue-500/15 rounded-full blur-2xl pointer-events-none"></div>

          <h1 className="text-3xl font-black tracking-widest bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-300 to-indigo-400 drop-shadow-[0_0_15px_rgba(168,85,247,0.7)]">
            CHESS ARENA
          </h1>
          <p className="text-[10px] uppercase font-bold tracking-widest text-purple-300 mt-1 flex items-center gap-2">
            Play <span className="text-purple-500 text-xs shadow-sm">•</span> Compete <span className="text-purple-500 text-xs">•</span> Win
          </p>

          <div className="mt-4 w-full bg-[#1b0e38]/80 border border-purple-500/30 rounded-xl py-2 px-3.5 text-left flex items-center justify-between gap-2 shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
            <div className="truncate">
              <span className="text-[9px] font-black uppercase bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 px-1.5 py-0.5 rounded shadow-[0_0_8px_rgba(245,158,11,0.5)] mr-1.5 inline-block">PROMO</span>
              <span className="text-[11px] text-purple-100 font-semibold tracking-wide">Earn double tokens on matches today!</span>
            </div>
            <span className="text-amber-400 text-xs shrink-0 drop-shadow-[0_0_4px_rgba(245,158,11,0.5)]">⚡</span>
          </div>
        </section>

        {/* Dynamic Flow Notification Banner */}
        <div className={`text-center text-xs font-bold py-2.5 px-3 rounded-xl transition-all duration-300 ${notificationClass}`}>
          {notificationText}
        </div>

        {/* Step 1: Select Mode */}
        <div className="space-y-1.5">
          <label className="text-[9px] font-black tracking-widest text-purple-400/80 uppercase block">1. Select Mode</label>
          <div className="grid grid-cols-2 gap-3">
            <div 
              onPointerDown={() => handleSelectMode('computer')} 
              className={`rounded-xl p-3 flex flex-col items-center justify-center cursor-pointer transition duration-200 ${
                mode === 'computer' 
                  ? "bg-[#130d2d] border-2 border-blue-500 bg-blue-950/20 shadow-[0_0_15px_rgba(59,130,246,0.35)]" 
                  : "bg-[#110924] border border-[#26184a] shadow-lg hover:border-blue-500/30"
              }`}
            >
              <div className="w-11 h-11 mb-2 bg-gradient-to-b from-blue-500/15 to-transparent rounded-full flex items-center justify-center text-2xl drop-shadow-[0_0_8px_rgba(59,130,246,0.3)]">🤖</div>
              <h3 className="font-black text-sm tracking-wide text-gray-200">VS AI</h3>
              <p className="text-[10px] text-gray-500 mt-0.5">Practice Mode</p>
            </div>

            <div 
              onPointerDown={() => handleSelectMode('human')} 
              className={`rounded-xl p-3 flex flex-col items-center justify-center cursor-pointer transition duration-200 ${
                mode === 'human' 
                  ? "bg-[#190d33] border-2 border-purple-500 bg-purple-950/20 shadow-[0_0_15px_rgba(16,185,129,0.35)]" 
                  : "bg-[#110924] border border-[#26184a] shadow-lg hover:border-purple-500/30"
              }`}
            >
              <div className="w-11 h-11 mb-2 bg-gradient-to-b from-purple-500/15 to-transparent rounded-full flex items-center justify-center text-xl drop-shadow-[0_0_8px_rgba(168,85,247,0.3)]">⚔️</div>
              <h3 className="font-black text-sm tracking-wide text-gray-200">VS HUMAN</h3>
              <p className="text-[10px] text-gray-500 mt-0.5">Online Mode</p>
            </div>
          </div>
        </div>

        {/* Step 2: Select Entry Style */}
        <div className="space-y-1.5">
          <label className="text-[9px] font-black tracking-widest text-purple-400/80 uppercase block">2. Select Entry Style</label>
          <div className="space-y-2">
            <button 
              onPointerDown={() => handleSelectStyle('bet')} 
              className={`w-full bg-gradient-to-r from-[#8a6207] via-[#e6b82e] to-[#8a6207] text-slate-950 font-black text-xs py-3.5 rounded-xl flex items-center justify-center gap-2 shadow-[0_4px_15px_rgba(230,184,46,0.25)] transition tracking-wider uppercase border border-yellow-400/30 ${
                mode === 'computer' ? 'opacity-40 cursor-not-allowed' : ''
              }`}
            >
              🪙 Play With Bet <span className={`text-[10px] inline-block transition-transform duration-200 ${betPanelOpen ? 'rotate-90' : ''}`}>❯</span>
            </button>

            {/* Bet Panel */}
            <section className={`bet-panel-transition ${betPanelOpen ? 'max-h-[300px] opacity-100' : 'bet-panel-hidden'} bg-[#0e071f] border border-[#2b1b54] rounded-xl p-3.5 space-y-4 shadow-inner`}>
              <div>
                <div className="grid grid-cols-3 gap-2 text-xs font-bold">
                  {Object.entries(CURRENCY_CONFIG).map(([key, c]) => (
                    <button 
                      key={key} 
                      onPointerDown={() => { setCurrency(key); setStake(c.stakes[1]); setCurrentStep(1); }}
                      className={`py-2 rounded-lg flex items-center justify-center gap-1.5 transition ${
                        currency === key 
                          ? `bg-[#0f0921] border-2 border-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.2)]` 
                          : 'bg-[#0f0921] border border-[#231742] text-gray-400 hover:text-white'
                      }`}
                    >
                      {c.icon} {key}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[9px] font-bold tracking-widest text-gray-400 uppercase block mb-2">Select Stake Amount ({currency})</label>
                <div className="grid grid-cols-5 gap-1.5 text-[11px] font-bold">
                  {cfg.stakes.filter(s => s > 0).map(s => (
                    <button 
                      key={s} 
                      onPointerDown={() => handleConfirmStake(s)} 
                      className={`py-2 rounded transition ${
                        stake === s 
                          ? "bg-emerald-600 border border-emerald-400 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)] font-black" 
                          : "bg-[#120a26] border border-[#221640] text-gray-300 hover:border-purple-500"
                      }`}
                    >
                      {cfg.symbol}{s}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <button 
              onPointerDown={() => handleSelectStyle('free')} 
              className={`w-full bg-gradient-to-r from-[#391363] to-[#5c209e] border border-purple-500/50 text-purple-100 font-black text-xs py-3.5 rounded-xl flex items-center justify-center gap-2 shadow-lg uppercase tracking-wider ${
                stake === 0 && currentStep >= 2 ? 'border-2 border-purple-400 bg-purple-900/40' : ''
              }`}
            >
              🎮 Play For Free
            </button>
          </div>
        </div>

        {/* Step 3: Game Actions */}
        <div className="space-y-1.5">
          <label className="text-[9px] font-black tracking-widest text-purple-400/80 uppercase block">3. Start Game Action</label>
          
          {mode === 'human' ? (
            <div className="grid grid-cols-2 gap-2">
              <button 
                onPointerDown={() => {
                  if (currentStep < 2) {
                    setStatus('⚠️ Please choose Play With Bet or Play For Free first!')
                    return
                  }
                  findMatch()
                }} 
                className="w-full bg-gradient-to-r from-[#059652] to-[#05a85c] text-white font-black text-xs py-3.5 rounded-xl flex items-center justify-center gap-1.5 shadow-[0_4px_12px_rgba(5,150,82,0.3)] hover:brightness-110 transition tracking-wider uppercase"
              >
                🔍 Find Match
              </button>
              <button 
                onPointerDown={() => {
                  if (currentStep < 2) {
                    setStatus('⚠️ Please choose Play With Bet or Play For Free first!')
                    return
                  }
                  createMatch()
                }} 
                className="w-full bg-gradient-to-r from-[#5c1a9e] to-[#6d20bd] text-white font-black text-xs py-3.5 rounded-xl flex items-center justify-center gap-1.5 shadow-[0_4px_12px_rgba(92,26,158,0.3)] hover:brightness-110 transition tracking-wider uppercase"
              >
                ⚔️ Create Match
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <button 
                onPointerDown={() => {
                  setDifficulty('easy')
                  setPlayerColor('white')
                  setCurrentStep(2)
                  startVsComputer()
                }} 
                className="bg-gradient-to-b from-emerald-950/80 to-emerald-900/60 border border-emerald-500/50 text-emerald-300 font-black text-xs py-3.5 rounded-xl flex flex-col items-center justify-center transition tracking-wider uppercase shadow-[0_4px_10px_rgba(16,185,129,0.15)]"
              >
                <span className="text-sm mb-0.5 drop-shadow-[0_0_5px_rgba(16,185,129,0.6)]">🟢</span> Beginner
              </button>
              <button 
                onPointerDown={() => {
                  setDifficulty('medium')
                  setPlayerColor('white')
                  setCurrentStep(2)
                  startVsComputer()
                }} 
                className="bg-gradient-to-b from-amber-950/80 to-amber-900/60 border border-amber-500/50 text-amber-300 font-black text-xs py-3.5 rounded-xl flex flex-col items-center justify-center transition tracking-wider uppercase shadow-[0_4px_10px_rgba(245,158,11,0.15)]"
              >
                <span className="text-sm mb-0.5 drop-shadow-[0_0_5px_rgba(245,158,11,0.6)]">🟡</span> Medium
              </button>
              <button 
                onPointerDown={() => {
                  setDifficulty('hard')
                  setPlayerColor('white')
                  setCurrentStep(2)
                  startVsComputer()
                }} 
                className="bg-gradient-to-b from-rose-950/80 to-rose-900/60 border border-rose-500/50 text-rose-300 font-black text-xs py-3.5 rounded-xl flex flex-col items-center justify-center transition tracking-wider uppercase shadow-[0_4px_10px_rgba(244,63,94,0.15)]"
              >
                <span className="text-sm mb-0.5 drop-shadow-[0_0_5px_rgba(244,63,94,0.6)]">🔴</span> Hard
              </button>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="relative flex items-center justify-center py-1">
          <div className="flex-grow border-t border-[#221644]"></div>
          <span className="flex-shrink mx-3 text-[9px] font-black text-gray-500 tracking-widest uppercase">Or Join</span>
          <div className="flex-grow border-t border-[#221644]"></div>
        </div>

        {/* Join Match ID Panel */}
        <div className="bg-[#0d071f] border border-[#25174a] p-3 rounded-xl flex gap-2 items-center shadow-inner">
          <input 
            type="text" 
            placeholder="Paste match ID..." 
            value={joinId}
            onChange={e => setJoinId(e.target.value)}
            className="bg-[#070312] border border-[#231742] rounded-lg px-3 py-2 text-xs flex-grow focus:outline-none focus:border-purple-500 text-gray-200 placeholder-gray-600 transition" 
          />
          <button 
            onPointerDown={joinMatch} 
            className="bg-gradient-to-r from-[#4d1991] to-[#5c20bd] text-white font-black text-xs py-2 px-3.5 rounded-lg whitespace-nowrap shadow-md"
          >
            🔗 Join Match
          </button>
        </div>

        {/* Other Games */}
        <section className="space-y-2 pt-1">
          <div className="relative flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-wider text-purple-400/80 uppercase">Other Games</span>
            <div className="flex-grow ml-3 border-t border-[#1f143d]"></div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-[10px] font-black text-center">
            <div onPointerDown={() => alert('Ludo is Coming Soon!')} className="bg-[#110924] border border-[#231644] py-3.5 px-1 rounded-xl flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-[#1a0e36] hover:border-purple-500/40 transition duration-150 shadow-md">
              <span className="text-xl drop-shadow-[0_0_4px_rgba(245,158,11,0.3)]">🎲</span> <span className="text-gray-300 tracking-wide">LUDO</span>
            </div>
            <div onPointerDown={() => alert('Poker is Coming Soon!')} className="bg-[#110924] border border-[#231644] py-3.5 px-1 rounded-xl flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-[#1a0e36] hover:border-purple-500/40 transition duration-150 shadow-md">
              <span className="text-xl drop-shadow-[0_0_4px_rgba(239,68,68,0.3)]">🃏</span> <span className="text-gray-300 tracking-wide">POKER</span>
            </div>
            <div onPointerDown={() => alert('FIFA is Coming Soon!')} className="bg-[#110924] border border-[#231644] py-3.5 px-1 rounded-xl flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-[#1a0e36] hover:border-purple-500/40 transition duration-150 shadow-md">
              <span className="text-xl drop-shadow-[0_0_4px_rgba(59,130,246,0.3)]">⚽</span> <span className="text-gray-300 tracking-wide">FIFA</span>
            </div>
            <div onPointerDown={() => alert('More Games Coming Soon!')} className="bg-[#110924] border border-[#231644] py-3.5 px-1 rounded-xl flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-[#1a0e36] hover:border-purple-500/40 transition duration-150 shadow-md">
              <span className="text-xl drop-shadow-[0_0_4px_rgba(168,85,247,0.3)]">🎯</span> <span className="text-purple-400 text-[8px] leading-tight font-black uppercase">MORE</span>
            </div>
          </div>
        </section>

        {/* Leaderboard */}
        <section className="space-y-2 pt-1">
          <div className="relative flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-wider text-purple-400/80 uppercase">Leaderboard</span>
            <div className="flex-grow ml-3 border-t border-[#1f143d]"></div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs font-semibold">
            <div className="bg-[#110924] border border-[#26174a] p-2.5 rounded-xl flex items-center gap-2 shadow-md">
              <span className="text-base drop-shadow-[0_0_5px_rgba(245,158,11,0.5)]">🥇</span>
              <div className="w-6 h-6 rounded-full bg-purple-950/80 border border-purple-500/40 flex items-center justify-center text-[10px]">👤</div>
              <div>
                <p className="text-[10px] font-bold text-white truncate max-w-[55px]">PlayerA</p>
                <p className="text-[9px] text-amber-400 font-black tracking-wide">2500 ELO</p>
              </div>
            </div>
            <div className="bg-[#110924] border border-[#26174a] p-2.5 rounded-xl flex items-center gap-2 shadow-md">
              <span className="text-base drop-shadow-[0_0_5px_rgba(148,163,184,0.5)]">🥈</span>
              <div className="w-6 h-6 rounded-full bg-purple-950/80 border border-purple-500/40 flex items-center justify-center text-[10px]">👤</div>
              <div>
                <p className="text-[10px] font-bold text-white truncate max-w-[55px]">PlayerB</p>
                <p className="text-[9px] text-amber-400 font-black tracking-wide">2400 ELO</p>
              </div>
            </div>
            <div className="bg-[#110924] border border-[#26174a] p-2.5 rounded-xl flex items-center gap-2 shadow-md">
              <span className="text-base drop-shadow-[0_0_5px_rgba(180,83,9,0.5)]">🥉</span>
              <div className="w-6 h-6 rounded-full bg-purple-950/80 border border-purple-500/40 flex items-center justify-center text-[10px]">👤</div>
              <div>
                <p className="text-[10px] font-bold text-white truncate max-w-[55px]">PlayerC</p>
                <p className="text-[9px] text-amber-400 font-black tracking-wide">2300 ELO</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    )
  }

  function renderHelp() {
    const Section = ({ title, children }) => (
      <div className="bg-[#111827] border border-white/5 rounded-xl p-4 w-full">
        <p className="text-indigo-400 text-xs font-black tracking-wider uppercase mb-2.5">{title}</p>
        {children}
      </div>
    )
    const Row = ({ label, value, colorClass = 'text-indigo-300' }) => (
      <div className="flex justify-between py-1.5 border-b border-white/5 text-xs">
        <span className="text-gray-500">{label}</span>
        <span className={`${colorClass} font-bold`}>{value}</span>
      </div>
    )
    const P = ({ children }) => (
      <p className="text-gray-400 text-xs leading-relaxed mb-2">{children}</p>
    )

    return (
      <div className="flex-1 flex flex-col justify-between h-full bg-[#080B14]">
        {/* Header */}
        <header className="px-4 pt-3 pb-2 bg-[#0e071f] flex justify-between items-center border-b border-[#1b1233] shrink-0 z-50">
          <button onPointerDown={() => setScreen(helpFromRef.current)} className="text-gray-400 hover:text-white transition">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          </button>
          <div className="font-bold text-base tracking-wide bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-purple-300">Help & Rules</div>
          <div className="w-6" />
        </header>

        {/* Scrollable content */}
        <main className="p-3 space-y-4 flex-grow overflow-y-auto no-scrollbar pb-8">
          <Section title="♟ HOW TO PLAY">
            <P>Tap any of your pieces to select it. Legal moves appear as dots on the board. Tap a dot to move there. Tap a different piece to switch selection.</P>
            <P>Capture squares show a ring around the enemy piece. The goal is to checkmate the opponent's king — trap it so it cannot escape.</P>
          </Section>

          <Section title="🎨 BOARD COLOURS">
            <Row label="🟨 Yellow / Brown" value="Normal squares" />
            <Row label="🟩 Green" value="Last move (from → to)" colorClass="text-lime-400" />
            <Row label="🟪 Purple" value="Selected piece" colorClass="text-indigo-400" />
            <Row label="🔴 Red" value="King in check" colorClass="text-rose-500" />
            <Row label="⚪ White dot" value="Legal move target" />
            <Row label="🟢 Green dot" value="Legal move (Easy mode hint)" colorClass="text-emerald-400" />
          </Section>

          <Section title="♟ PIECE VALUES">
            <Row label="♙ Pawn"   value="1 point" />
            <Row label="♘ Knight" value="3 points" />
            <Row label="♗ Bishop" value="3 points" />
            <Row label="♖ Rook"   value="5 points" />
            <Row label="♕ Queen"  value="9 points" />
            <Row label="♔ King"   value="∞ — protect at all costs" colorClass="text-rose-500" />
          </Section>

          <Section title="💰 CURRENCIES">
            {Object.entries(CURRENCY_CONFIG).map(([key, c]) => (
              <Row key={key} label={`${c.icon} ${key}`} value={c.description.split('—')[0].trim()} colorClass="text-indigo-300" />
            ))}
            <P className="mt-2">All balances are held in a secure escrow on the server. Stakes are locked the moment both players join. You are never charged unless a complete match is played.</P>
          </Section>

          <Section title="🏆 PRIZE STRUCTURE">
            <P>When you win a match:</P>
            <Row label="Your stake" value="Returned" colorClass="text-emerald-400" />
            <Row label="Opponent's stake" value="90% to you" colorClass="text-emerald-400" />
            <Row label="Platform fee" value="10% rake" colorClass="text-gray-500" />
            <P>On a draw, both players receive their original stake back. No rake is charged on draws.</P>
          </Section>

          <Section title="🤖 VS COMPUTER MODES">
            <Row label="🟢 Easy"   value="Random legal moves — perfect for beginners" />
            <Row label="🟡 Medium" value="2-ply minimax — plays solid, won't blunder big pieces" />
            <Row label="🔴 Hard"   value="3-ply minimax + alpha-beta — tactical, punishes mistakes" />
            <P>Computer moves are computed locally on your device — no internet needed, instant response.</P>
          </Section>

          <Section title="🔒 SECURITY">
            <P>Your Telegram identity is verified with HMAC-SHA256 on every request. Stakes are validated server-side — the frontend never controls financial logic. All payouts are atomic — a match can only be settled once.</P>
            <P>If you disconnect mid-game, your opponent wins automatically. If both players disconnect simultaneously, stakes are refunded.</P>
          </Section>

          <button onPointerDown={() => setScreen(helpFromRef.current)} className="w-full bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white font-black text-xs py-3.5 rounded-xl uppercase tracking-wider shadow-lg">
            ← Back to Game
          </button>
        </main>
      </div>
    )
  }

  function renderQueue() {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-5 space-y-6 h-full bg-[#0a0516]">
        <div className="text-6xl animate-pulse">♟</div>
        <h2 className="font-black text-xl text-purple-400 tracking-wide">Finding Opponent</h2>
        <p className="text-gray-500 text-xs">
          {cfg.icon} {cfg.symbol}{stake} {cfg.unit} stake
        </p>

        <div className="bg-[#111827] border border-indigo-500/30 rounded-xl py-4 px-8 text-center shadow-lg">
          <div className="text-indigo-300 text-3xl font-black tabular-nums">
            {String(Math.floor(queueSeconds / 60)).padStart(2,'0')}:{String(queueSeconds % 60).padStart(2,'0')}
          </div>
          <div className="text-gray-600 text-[10px] uppercase font-bold tracking-wider mt-1">searching...</div>
        </div>

        <div className="text-gray-400 text-xs text-center max-w-[260px] leading-relaxed">
          {status || '🔍 Matching you with a player at the same stake...'}
        </div>

        <div className="flex gap-5 bg-[#111827] border border-white/5 rounded-xl py-3 px-6 shadow-inner">
          <div className="text-center">
            <div className="text-gray-500 text-[10px]">Pool</div>
            <div className="text-indigo-300 font-bold">{cfg.symbol}{pool.toFixed(cfg.decimals)}</div>
          </div>
          <div className="w-px bg-white/5" />
          <div className="text-center">
            <div className="text-gray-500 text-[10px]">You Win</div>
            <div className="text-emerald-400 font-bold">{cfg.symbol}{win.toFixed(cfg.decimals)}</div>
          </div>
        </div>

        <button 
          onPointerDown={() => { cancelQueue(); setScreen('home') }}
          className="bg-transparent border border-gray-800 text-gray-500 hover:text-white px-8 py-3 rounded-xl font-bold text-sm tracking-wider transition"
        >
          ✕ Cancel Search
        </button>
      </div>
    )
  }

  function renderLobby() {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-5 space-y-6 h-full bg-[#0a0516]">
        <div className="text-5xl">⚔️</div>
        <h2 className="font-black text-xl text-purple-400 tracking-wide">Match Created!</h2>
        <p className="text-gray-500 text-xs">Share this ID with your opponent</p>

        <div className="bg-[#111827] border border-white/5 rounded-xl p-4 w-full text-center space-y-2">
          <p className="text-gray-500 text-[10px] uppercase font-bold tracking-wider">Match ID</p>
          <div className="bg-[#0f1f3d] border border-[#1a3a5c] rounded-lg p-3 font-mono text-xs text-indigo-300 word-break-all select-all">
            {matchId}
          </div>
          <button 
            onPointerDown={() => { navigator.clipboard.writeText(matchId); setStatus('✅ Copied!') }}
            className="w-full bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-bold text-xs py-3 rounded-lg mt-2 shadow-md uppercase tracking-wider"
          >
            📋 Copy Match ID
          </button>
        </div>

        <div className="text-gray-400 text-xs animate-pulse">⏳ Waiting for opponent...</div>
        {status && <div className="text-emerald-400 text-xs font-semibold">{status}</div>}

        <button 
          onPointerDown={reset} 
          className="bg-transparent border border-gray-800 text-gray-500 hover:text-white px-8 py-3 rounded-xl font-bold text-xs tracking-wider transition uppercase"
        >
          ← Cancel
        </button>
      </div>
    )
  }

  function renderGame() {
    const boardOri   = isBot ? playerColor : (color === 'black' ? 'black' : 'white')
    const humanTurn  = isBot
      ? (!gameOver && !botThinking && chessRef.current.turn() === (playerColor === 'white' ? 'w' : 'b'))
      : (myTurnUI && !result)
    const showHints  = isBot && difficulty === 'easy'

    return (
      <div className="flex-1 flex flex-col justify-between p-3.5 space-y-3.5 h-full bg-[#0a0516] overflow-y-auto no-scrollbar">
        {/* Header */}
        <div className="flex justify-between items-center w-full">
          <div>
            <div className="font-black text-sm text-purple-400 tracking-wide">♟ CHESS ARENA</div>
            <div className="text-gray-500 text-[10px]">
              {isBot
                ? <>You play <strong className="text-indigo-300">{playerColor}</strong> · {difficulty}</>
                : <>You are <strong className="text-indigo-300">{color}</strong> · {cfg.symbol}{stake} stake</>
              }
            </div>
          </div>
          <div className={`border rounded-lg px-3 py-1 text-[11px] font-black uppercase shadow-sm ${
            botThinking 
              ? 'bg-amber-500/10 border-amber-500/40 text-amber-400' 
              : humanTurn 
              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' 
              : 'bg-indigo-500/10 border-indigo-500/40 text-indigo-400'
          }`}>
            {botThinking ? '🤖 Thinking' : humanTurn ? '⚡️ Your turn' : '⏳ Waiting'}
          </div>
        </div>

        {/* Status Bar */}
        <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl py-2.5 px-4 text-center text-xs font-semibold text-indigo-300 w-full shadow-inner">
          {status || '♟ Game in progress'}
        </div>

        {/* Custom Chessboard Container */}
        <div className="w-full flex justify-center">
          <div className="w-full max-w-[390px] aspect-square">
            <ChessBoard
              chess={chessRef.current}
              orientation={boardOri}
              selectedSq={humanTurn ? selectedSq : null}
              legalTargets={humanTurn ? legalTargets : []}
              onSquareTap={isBot ? handleSquareTap : handleMultiSquareTap}
              showHints={showHints}
              lastMove={lastMove}
              checkedKingSq={checkedKingSq}
            />
          </div>
        </div>

        {/* Easy mode hints */}
        {showHints && humanTurn && !gameOver && (
          <div className="text-emerald-400 text-[10px] text-center font-bold tracking-wide animate-pulse">
            💡 Tap any piece to see where it can move
          </div>
        )}

        {/* Move History */}
        {isBot && moveHistory.length > 0 && (
          <div className="bg-[#111827] border border-white/5 rounded-xl p-2.5 max-h-[70px] overflow-y-auto no-scrollbar w-full shadow-inner">
            <div className="flex flex-wrap gap-1.5">
              {moveHistory.map((m, i) => (
                <span key={i} className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  i % 2 === 0 ? 'bg-white/5 text-gray-400' : 'bg-indigo-500/10 text-indigo-300'
                }`}>
                  {i % 2 === 0 ? `${Math.floor(i/2)+1}.` : ''}{m}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Prize pool summary */}
        {!isBot && (
          <div className="flex justify-between items-center w-full bg-[#111827] border border-white/5 rounded-xl py-2 px-4 shadow-inner text-xs">
            <div>
              <div className="text-gray-500 text-[9px]">Prize Pool</div>
              <div className="text-emerald-400 font-bold">{cfg.symbol}{pool.toFixed(cfg.decimals)} {cfg.unit}</div>
            </div>
            <div className="w-px h-6 bg-white/5" />
            <div className="text-right">
              <div className="text-gray-500 text-[9px]">Winner Gets</div>
              <div className="text-indigo-300 font-bold">{cfg.symbol}{win.toFixed(cfg.decimals)} {cfg.unit}</div>
            </div>
          </div>
        )}

        {/* Control Buttons */}
        <div className="flex gap-2.5 w-full">
          {(result || gameOver) && (
            <button 
              onPointerDown={isBot ? startVsComputer : reset}
              className="flex-1 bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white font-black text-xs py-3.5 rounded-xl uppercase tracking-wider shadow-lg transition"
            >
              🔄 Play Again
            </button>
          )}
          <button 
            onPointerDown={reset}
            className={`py-3.5 rounded-xl font-black text-xs tracking-wider transition uppercase border border-gray-800 text-gray-500 hover:text-white ${
              result || gameOver ? 'px-5' : 'flex-grow'
            }`}
          >
            ← Home
          </button>
        </div>
      </div>
    )
  }

  // ─── CONSOLIDATED RENDER ───────────────────────────────────────────────────
  return (
    <div className="text-white flex justify-center items-center min-h-screen p-0 sm:p-4 bg-[#03010a] font-sans">
      <div className="w-full max-w-md bg-[#0a0516] h-screen sm:h-[850px] flex flex-col justify-between shadow-[0_0_50px_rgba(139,92,246,0.15)] relative overflow-hidden border-x border-slate-900 sm:rounded-3xl">
        
        {/* Render header (present on home screen) */}
        {screen === 'home' && (
          <header className="px-4 pt-3 pb-2 bg-[#0e071f] flex justify-between items-center border-b border-[#1b1233] shrink-0 z-50">
            <button onPointerDown={reset} className="text-gray-400 hover:text-white transition">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <div className="flex items-center gap-1.5 cursor-pointer" onPointerDown={() => setScreen('home')}>
              <span className="font-bold text-base tracking-wide bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-purple-300">ChessGame</span>
              <span className="text-lg drop-shadow-[0_0_6px_rgba(168,85,247,0.6)]">♟️</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
            </div>
            <button onPointerDown={() => { helpFromRef.current = screen; setScreen('help') }} className="text-gray-400 hover:text-white transition">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" /></svg>
            </button>
          </header>
        )}

        {/* Scrollable content area */}
        <div className="flex-1 flex flex-col justify-between overflow-hidden">
          {screen === 'home' && renderHome()}
          {screen === 'profile' && <ProfileScreen onBack={() => setScreen('home')} />}
          {screen === 'help' && renderHelp()}
          {screen === 'queue' && renderQueue()}
          {screen === 'lobby' && renderLobby()}
          {screen === 'game' && renderGame()}
        </div>

        {/* Render footer (present on home and profile screens) */}
        {(screen === 'home' || screen === 'profile') && (
          <footer className="bg-[#0b0617] border-t border-[#231545] grid grid-cols-5 text-center py-3 text-gray-300 text-xs font-black shrink-0 z-40 shadow-[0_-8px_25px_rgba(139,92,246,0.15)]">
            <button onPointerDown={() => setScreen('home')} className={`${screen === 'home' ? 'text-purple-200 drop-shadow-[0_0_12px_rgba(168,85,247,0.75)]' : 'hover:text-gray-150 transition duration-100'} flex flex-col items-center justify-center gap-1`}>
              <span className="text-lg">🏠</span> 
              <span>Home</span>
            </button>
            <button onPointerDown={() => alert('Leaderboard is displayed below on the home page.')} className="hover:text-gray-150 flex flex-col items-center justify-center gap-1 transition duration-150">
              <span className="text-lg">🏆</span>
              <span>Rank</span>
            </button>
            <button onPointerDown={() => { setScreen('profile') }} className={`${screen === 'profile' ? 'text-purple-200 drop-shadow-[0_0_12px_rgba(168,85,247,0.75)]' : 'hover:text-gray-150 transition duration-100'} flex flex-col items-center justify-center gap-1`}>
              <span className="text-lg">📜</span>
              <span>History</span>
            </button>
            <button onPointerDown={() => alert('Support Chat coming soon.')} className="hover:text-gray-150 flex flex-col items-center justify-center gap-1 transition duration-100">
              <span className="text-lg">💬</span>
              <span>Chat</span>
            </button>
            <button onPointerDown={() => setScreen('profile')} className={`hover:text-gray-150 flex flex-col items-center justify-center gap-1 transition duration-100`}>
              <span className="text-lg">👤</span>
              <span>Me</span>
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}
