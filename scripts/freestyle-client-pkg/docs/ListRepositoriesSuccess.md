# ListRepositoriesSuccess


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**repositories** | [**List[RepositoryMetadata]**](RepositoryMetadata.md) |  | 
**total** | **int** |  | 
**offset** | **int** |  | 

## Example

```python
from freestyle_client.models.list_repositories_success import ListRepositoriesSuccess

# TODO update the JSON string below
json = "{}"
# create an instance of ListRepositoriesSuccess from a JSON string
list_repositories_success_instance = ListRepositoriesSuccess.from_json(json)
# print the JSON string representation of the object
print(ListRepositoriesSuccess.to_json())

# convert the object into a dict
list_repositories_success_dict = list_repositories_success_instance.to_dict()
# create an instance of ListRepositoriesSuccess from a dict
list_repositories_success_from_dict = ListRepositoriesSuccess.from_dict(list_repositories_success_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


