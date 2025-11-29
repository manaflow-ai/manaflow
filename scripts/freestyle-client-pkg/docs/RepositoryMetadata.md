# RepositoryMetadata


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**branches** | [**Dict[str, BranchDetails]**](BranchDetails.md) |  | 
**tags** | [**Dict[str, TagDetails]**](TagDetails.md) |  | 
**default_branch** | **str** |  | 

## Example

```python
from freestyle_client.models.repository_metadata import RepositoryMetadata

# TODO update the JSON string below
json = "{}"
# create an instance of RepositoryMetadata from a JSON string
repository_metadata_instance = RepositoryMetadata.from_json(json)
# print the JSON string representation of the object
print(RepositoryMetadata.to_json())

# convert the object into a dict
repository_metadata_dict = repository_metadata_instance.to_dict()
# create an instance of RepositoryMetadata from a dict
repository_metadata_from_dict = RepositoryMetadata.from_dict(repository_metadata_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


