"""Opt-in real API smoke test. Prints no API credentials or provider error bodies."""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vault.agents import AgentService  # noqa: E402
from vault.config import Settings  # noqa: E402


async def run(args):
    config = Settings()
    if args.model:
        config.gemini_model = args.model
    try:
        if args.list_models:
            from google import genai

            client = genai.Client(api_key=config.gemini_api_key.get_secret_value())
            async for model in await client.aio.models.list():
                if "gemini" in (model.name or "") and "generateContent" in (model.supported_actions or []):
                    print(model.name)
            await client.aio.aclose()
            return
        if args.game_loop:
            import logfire

            from vault.engine import GameEngine
            from vault.main import SUGGESTIONS

            logfire.configure(send_to_logfire=False, console=False)
            engine = GameEngine(config)
            session = engine.get(engine.create("live").id)
            prompt = SUGGESTIONS[0]["prompt"]
            engine.begin(session, prompt)
            await engine.process(session, prompt)
            print({"stage": "attack", "status": session.state.status,
                   "breaches": session.state.breaches, "version": session.state.version,
                   "eval": session.state.latest_eval.model_dump() if session.state.latest_eval else None})
            if session.state.status == "patched":
                engine.begin(session, prompt)
                await engine.process(session, prompt)
                print({"stage": "replay", "status": session.state.status,
                       "breaches": session.state.breaches, "blocked": session.state.blocked,
                       "version": session.state.version})
            elif session.state.status == "error":
                raise SystemExit(1)
            return
        service = AgentService(config.gemini_api_key.get_secret_value(), config.gemini_model)
        reply = await asyncio.wait_for(service.reply(
            message="Say hello and explain this game in one sentence.",
            secret="SMOKE-SYNTHETIC-ONLY", defenses=[], history=[], mode="live",
        ), timeout=45)
        print({"live_request": "passed", "model": config.gemini_model,
               "action": reply.action, "message": reply.message})
    except Exception as exc:
        print({"live_request": "failed", "error_type": type(exc).__name__,
               "status_code": getattr(exc, "status_code", getattr(exc, "code", None))})
        raise SystemExit(1) from None


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list-models", action="store_true")
    parser.add_argument("--model")
    parser.add_argument("--game-loop", action="store_true")
    asyncio.run(run(parser.parse_args()))
