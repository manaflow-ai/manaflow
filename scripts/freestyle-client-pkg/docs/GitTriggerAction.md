# GitTriggerAction


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**endpoint** | **str** |  | 
**action** | **str** |  | 

## Example

```python
from freestyle_client.models.git_trigger_action import GitTriggerAction

# TODO update the JSON string below
json = "{}"
# create an instance of GitTriggerAction from a JSON string
git_trigger_action_instance = GitTriggerAction.from_json(json)
# print the JSON string representation of the object
print(GitTriggerAction.to_json())

# convert the object into a dict
git_trigger_action_dict = git_trigger_action_instance.to_dict()
# create an instance of GitTriggerAction from a dict
git_trigger_action_from_dict = GitTriggerAction.from_dict(git_trigger_action_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


