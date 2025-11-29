# ConfigureGithubSyncRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**github_repo_name** | **str** | The GitHub repository name in \&quot;owner/repo\&quot; format | 

## Example

```python
from freestyle_client.models.configure_github_sync_request import ConfigureGithubSyncRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ConfigureGithubSyncRequest from a JSON string
configure_github_sync_request_instance = ConfigureGithubSyncRequest.from_json(json)
# print the JSON string representation of the object
print(ConfigureGithubSyncRequest.to_json())

# convert the object into a dict
configure_github_sync_request_dict = configure_github_sync_request_instance.to_dict()
# create an instance of ConfigureGithubSyncRequest from a dict
configure_github_sync_request_from_dict = ConfigureGithubSyncRequest.from_dict(configure_github_sync_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


