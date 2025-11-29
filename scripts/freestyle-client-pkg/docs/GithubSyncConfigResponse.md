# GithubSyncConfigResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**github_repo_name** | **str** |  | 

## Example

```python
from freestyle_client.models.github_sync_config_response import GithubSyncConfigResponse

# TODO update the JSON string below
json = "{}"
# create an instance of GithubSyncConfigResponse from a JSON string
github_sync_config_response_instance = GithubSyncConfigResponse.from_json(json)
# print the JSON string representation of the object
print(GithubSyncConfigResponse.to_json())

# convert the object into a dict
github_sync_config_response_dict = github_sync_config_response_instance.to_dict()
# create an instance of GithubSyncConfigResponse from a dict
github_sync_config_response_from_dict = GithubSyncConfigResponse.from_dict(github_sync_config_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


