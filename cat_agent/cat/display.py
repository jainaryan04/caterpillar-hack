"""Put things on the operator's screen (the mobile app, or this laptop for now).

The app gets an RTVI "server message", the standard way a Pipecat bot sends
data to a Pipecat client (iOS / Android / React Native / web SDKs all expose it
as `onServerMessage`):

    {"type": "manual-image", "image_id": "g00867598", "page": 94,
     "url": "/manual-images/g00867598.png", "width": 497, "height": 310,
     "caption": "Seat belt: fastening"}

"Open it" puts whole manual pages on screen the same way (one or two pages
side by side in one image):

    {"type": "manual-pages", "page": 94, "page_end": 94, "topic": "Seat Belt",
     "url": "/manual-pages/page-094.png", "width": 935, "height": 1210}

The app loads `url` from the Cat server, which serves data/manuals/images/
under /manual-images/ and data/manuals/pages/ under /manual-pages/. With the local mic/speaker transport there is no app, so
the message goes nowhere; set CAT_SHOW_IMAGES_LOCALLY=true (the default) to
also open the picture or page on this computer.
"""

import os
import sys
import webbrowser

from loguru import logger
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.processors.frameworks.rtvi.frames import RTVIServerMessageFrame

from cat.config import load_config
from cat.rag.images import ManualImage
from cat.rag.pages import ManualPages

IMAGE_URL_PREFIX = "/manual-images/"
PAGES_URL_PREFIX = "/manual-pages/"


async def show_manual_image(sender: FrameProcessor, image: ManualImage, caption: str) -> None:
    data = {
        "type": "manual-image",
        "image_id": image.id,
        "page": image.page,
        "url": f"{IMAGE_URL_PREFIX}{image.path.name}",
        "width": image.width,
        "height": image.height,
        "caption": caption,
    }
    await sender.push_frame(RTVIServerMessageFrame(data=data))
    logger.info(f"SCREEN: manual picture {image.id} (page {image.page}) - {caption}")
    _open_locally(image.path)


async def show_manual_pages(sender: FrameProcessor, pages: ManualPages, topic: str) -> None:
    data = {
        "type": "manual-pages",
        "page": pages.first,
        "page_end": pages.last,
        "topic": topic,
        "url": f"{PAGES_URL_PREFIX}{pages.path.name}",
        "width": pages.width,
        "height": pages.height,
    }
    await sender.push_frame(RTVIServerMessageFrame(data=data))
    logger.info(f"SCREEN: manual {pages.label()} - {topic}")
    _open_locally(pages.path)


def _open_locally(path) -> None:
    if not load_config().show_images_locally:
        return
    try:
        if sys.platform == "win32":
            os.startfile(path)  # opens in the default image viewer
        else:
            webbrowser.open(path.as_uri())
    except OSError as e:
        logger.warning(f"Couldn't open {path}: {e}")
