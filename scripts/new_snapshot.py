from morphcloud.api import (
    ApiError,
    Instance,
    InstanceExecResponse,
    MorphCloudClient,
    Snapshot,
)
from dotenv import load_dotenv

load_dotenv()

client = MorphCloudClient()

snapshot = client.snapshots.create(
    vcpus=4,
    memory=16_384,
    disk_size=32_768,
)

print(snapshot.id)