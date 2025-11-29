# GithubRepoSyncConfig


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**freestyle_repo_id** | **str** |  | 
**account_id** | **str** |  | 
**installation_id** | **int** |  | 
**github_repo_id** | **int** |  | 
**github_repo_name** | **str** |  | 
**created_at** | **datetime** |  | 

## Example

```python
from freestyle_client.models.github_repo_sync_config import GithubRepoSyncConfig

# TODO update the JSON string below
json = "{}"
# create an instance of GithubRepoSyncConfig from a JSON string
github_repo_sync_config_instance = GithubRepoSyncConfig.from_json(json)
# print the JSON string representation of the object
print(GithubRepoSyncConfig.to_json())

# convert the object into a dict
github_repo_sync_config_dict = github_repo_sync_config_instance.to_dict()
# create an instance of GithubRepoSyncConfig from a dict
github_repo_sync_config_from_dict = GithubRepoSyncConfig.from_dict(github_repo_sync_config_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


