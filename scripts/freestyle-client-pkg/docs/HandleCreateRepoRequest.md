# HandleCreateRepoRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** | This name is not visible to users, and is only accessible to you via API and in the dashboard. Mostly useful for observability. | [optional] 
**public** | **bool** |  | [optional] [default to False]
**default_branch** | **str** | The default branch name for the repository. Defaults to \&quot;main\&quot; if not specified. | [optional] 
**source** | [**CreateRepoSource**](CreateRepoSource.md) | Fork from another Git repository. Cannot be used with &#x60;import&#x60;. | [optional] 
**var_import** | [**CreateRepoImport**](CreateRepoImport.md) | Import static content with an initial commit. Cannot be used with &#x60;source&#x60;. | [optional] 
**dev_servers** | [**DevServerConfiguration**](DevServerConfiguration.md) |  | [optional] 

## Example

```python
from freestyle_client.models.handle_create_repo_request import HandleCreateRepoRequest

# TODO update the JSON string below
json = "{}"
# create an instance of HandleCreateRepoRequest from a JSON string
handle_create_repo_request_instance = HandleCreateRepoRequest.from_json(json)
# print the JSON string representation of the object
print(HandleCreateRepoRequest.to_json())

# convert the object into a dict
handle_create_repo_request_dict = handle_create_repo_request_instance.to_dict()
# create an instance of HandleCreateRepoRequest from a dict
handle_create_repo_request_from_dict = HandleCreateRepoRequest.from_dict(handle_create_repo_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


