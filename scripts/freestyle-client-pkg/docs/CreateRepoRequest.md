# CreateRepoRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**source** | [**CreateRepoSource**](CreateRepoSource.md) |  | [optional] 
**var_import** | [**CreateRepoImport**](CreateRepoImport.md) |  | [optional] 
**default_branch** | **str** |  | [optional] 

## Example

```python
from freestyle_client.models.create_repo_request import CreateRepoRequest

# TODO update the JSON string below
json = "{}"
# create an instance of CreateRepoRequest from a JSON string
create_repo_request_instance = CreateRepoRequest.from_json(json)
# print the JSON string representation of the object
print(CreateRepoRequest.to_json())

# convert the object into a dict
create_repo_request_dict = create_repo_request_instance.to_dict()
# create an instance of CreateRepoRequest from a dict
create_repo_request_from_dict = CreateRepoRequest.from_dict(create_repo_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


