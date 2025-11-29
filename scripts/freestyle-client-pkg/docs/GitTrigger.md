# GitTrigger


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**branches** | **List[str]** |  | [optional] 
**globs** | **List[str]** |  | [optional] 
**event** | **str** |  | 

## Example

```python
from freestyle_client.models.git_trigger import GitTrigger

# TODO update the JSON string below
json = "{}"
# create an instance of GitTrigger from a JSON string
git_trigger_instance = GitTrigger.from_json(json)
# print the JSON string representation of the object
print(GitTrigger.to_json())

# convert the object into a dict
git_trigger_dict = git_trigger_instance.to_dict()
# create an instance of GitTrigger from a dict
git_trigger_from_dict = GitTrigger.from_dict(git_trigger_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


