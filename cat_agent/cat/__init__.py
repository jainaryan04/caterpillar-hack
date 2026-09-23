"""Cat: voice assistant for CAT machine operators."""

from dotenv import load_dotenv

# Load .env once, before any module (Pipecat services, Agents SDK) reads OPENAI_API_KEY.
load_dotenv(override=True)
