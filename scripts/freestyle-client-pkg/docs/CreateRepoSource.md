# CreateRepoSource


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**url** | **str** |  | 
**branch** | **str** |  | [optional] 
**depth** | **int** |  | [optional] 

## Example

```python
from freestyle_client.models.create_repo_source import CreateRepoSource

# TODO update the JSON string below
json = "{}"
# create an instance of CreateRepoSource from a JSON string
create_repo_source_instance = CreateRepoSource.from_json(json)
# print the JSON string representation of the object
print(CreateRepoSource.to_json())

# convert the object into a dict
create_repo_source_dict = create_repo_source_instance.to_dict()
# create an instance of CreateRepoSource from a dict
create_repo_source_from_dict = CreateRepoSource.from_dict(create_repo_source_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


