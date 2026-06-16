winner = "white" if board.turn == chess.BLACK else "black"
                    result = {"type": "gameover", "reason": "checkmate", "winner": winner}
                elif board.is_stalemate():
                    result = {"type": "gameover", "reason": "stalemate", "winner": None}
                elif board.is_fifty_moves():
                    result = {"type": "gameover", "reason": "50-move rule", "winner": None}
                elif board.is_insufficient_material():
                    result = {"type": "gameover", "reason": "insufficient material", "winner": None}

                state = {
                    "type": "state",
                    "fen": board.fen(),
                    "last_move": data["move"],
                    "turn": "white" if board.turn == chess.WHITE else "black",
                    "in_check": board.is_check(),
                    "game_over": result is not None,
                    "result": result
                }

                # Send to both players
                for side in ["white", "black"]:
                    opponent_ws = game["ws"].get(side)
                    if opponent_ws:
                        try:
                            await opponent_ws.send_json(state)
                        except Exception:
                            pass

                if result:
                    # Clean up
                    del active_games[match_id]
                    return

    except WebSocketDisconnect:
        game["ws"][color] = None
        # Notify opponent
        other = "black" if color == "white" else "white"
        other_ws = game["ws"].get(other)
        if other_ws:
            try:
                await other_ws.send_json({
                    "type": "gameover",
                    "reason": "opponent_disconnected",
                    "winner": other
                })
            except Exception:
                pass