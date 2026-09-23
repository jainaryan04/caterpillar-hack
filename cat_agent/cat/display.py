"""Put things on the operator's screen (the mobile app, or this laptop for now).

The app gets an RTVI "server message", the standard way a Pipecat bot sends
data to a Pipecat client (iOS / Android / React Native / web SDKs all expose it
as `onServerMessage`):

    {"type": "manual-image", "image_id": "g00867598", "page": 94,
     "url": "/manual-images/g00867598.png", "width": 497, "height": 310,
     "caption": "Seat belt: fastening"}

The app loads `url` from the Cat server, which serves data/manuals/images/
under /manual-images/. With the local mic/speaker transport there is no app, so
the message goes nowhere; set CAT_SHOW_IMAGES_LOCALLY=true (the default) to
also open the picture on this computer.
"""

import os
import sys
import webbrowser

from loguru import logger
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.processors.frameworks.rtvi.frames import RTVIServerMessageFrame

from cat.config import load_config
from cat.rag.images import ManualImage

IMAGE_URL_PREFIX = "/manual-images/"


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

    if load_config().show_images_locally:
        try:
            if sys.platform == "win32":
                os.startfile(image.path)  # opens in the default image viewer
            else:
                webbrowser.open(image.path.as_uri())
        except OSError as e:
            logger.warning(f"Couldn't open {image.path}: {e}")
