# TagTarget


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**sha** | **str** | The target object&#39;s hash ID | 

## Example

```python
from freestyle_client.models.tag_target import TagTarget

# TODO update the JSON string below
json = "{}"
# create an instance of TagTarget from a JSON string
tag_target_instance = TagTarget.from_json(json)
# print the JSON string representation of the object
print(TagTarget.to_json())

# convert the object into a dict
tag_target_dict = tag_target_instance.to_dict()
# create an instance of TagTarget from a dict
tag_target_from_dict = TagTarget.from_dict(tag_target_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


