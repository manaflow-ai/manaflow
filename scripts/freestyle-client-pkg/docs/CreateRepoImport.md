# CreateRepoImport


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**files** | **Dict[str, str]** | A map of file names to their contents. | 
**commit_message** | **str** |  | 
**author_name** | **str** |  | [optional] 
**author_email** | **str** |  | [optional] 
**type** | **str** |  | 
**url** | **str** |  | 
**dir** | **str** |  | [optional] 
**branch** | **str** |  | [optional] 

## Example

```python
from freestyle_client.models.create_repo_import import CreateRepoImport

# TODO update the JSON string below
json = "{}"
# create an instance of CreateRepoImport from a JSON string
create_repo_import_instance = CreateRepoImport.from_json(json)
# print the JSON string representation of the object
print(CreateRepoImport.to_json())

# convert the object into a dict
create_repo_import_dict = create_repo_import_instance.to_dict()
# create an instance of CreateRepoImport from a dict
create_repo_import_from_dict = CreateRepoImport.from_dict(create_repo_import_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


