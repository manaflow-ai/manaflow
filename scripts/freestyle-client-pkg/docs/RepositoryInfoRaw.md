# RepositoryInfoRaw


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 
**name** | **str** |  | [optional] 
**account_id** | **str** |  | 
**visibility** | [**Visibility**](Visibility.md) |  | 
**default_branch** | **str** |  | 

## Example

```python
from freestyle_client.models.repository_info_raw import RepositoryInfoRaw

# TODO update the JSON string below
json = "{}"
# create an instance of RepositoryInfoRaw from a JSON string
repository_info_raw_instance = RepositoryInfoRaw.from_json(json)
# print the JSON string representation of the object
print(RepositoryInfoRaw.to_json())

# convert the object into a dict
repository_info_raw_dict = repository_info_raw_instance.to_dict()
# create an instance of RepositoryInfoRaw from a dict
repository_info_raw_from_dict = RepositoryInfoRaw.from_dict(repository_info_raw_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


