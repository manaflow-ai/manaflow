# TagObject

Tag object

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** | The tag name | 
**tagger** | [**Signature**](Signature.md) | The tagger who created the tag | [optional] 
**message** | **str** | The tag message | [optional] 
**target** | [**TagTarget**](TagTarget.md) | The object this tag points to | 
**sha** | **str** | The tag&#39;s hash ID | 

## Example

```python
from freestyle_client.models.tag_object import TagObject

# TODO update the JSON string below
json = "{}"
# create an instance of TagObject from a JSON string
tag_object_instance = TagObject.from_json(json)
# print the JSON string representation of the object
print(TagObject.to_json())

# convert the object into a dict
tag_object_dict = tag_object_instance.to_dict()
# create an instance of TagObject from a dict
tag_object_from_dict = TagObject.from_dict(tag_object_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


