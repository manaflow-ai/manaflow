from morphcloud.api import MorphCloudClient


SNAPSHOT_ID = "snapshot_edx10psw"



def main() -> None:
    client = MorphCloudClient()

    base_instance = client.instances.get(instance_id="morphvm_81dj11k0")

    print("branching instance...")
    _snapshot, [instance] = base_instance.branch(1)
    print(f"Created instance: {instance.id}")

    print("waiting for instance to be ready...")
    instance.wait_until_ready()
    print("instance is ready")
    print(instance.networking.http_services)

    print("executing pwd via instance.exec()...")
    print(instance.exec("pwd"))

    print("\ndone!")

    # press enter to kill
    input("Press Enter to kill instance...")
    instance.stop()
    print("instance killed")


if __name__ == "__main__":
    main()
