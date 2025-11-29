# FreestyleLogResponseObject


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**message** | **str** |  | 
**timestamp** | **str** |  | 

## Example

```python
from freestyle_client.models.freestyle_log_response_object import FreestyleLogResponseObject

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleLogResponseObject from a JSON string
freestyle_log_response_object_instance = FreestyleLogResponseObject.from_json(json)
# print the JSON string representation of the object
print(FreestyleLogResponseObject.to_json())

# convert the object into a dict
freestyle_log_response_object_dict = freestyle_log_response_object_instance.to_dict()
# create an instance of FreestyleLogResponseObject from a dict
freestyle_log_response_object_from_dict = FreestyleLogResponseObject.from_dict(freestyle_log_response_object_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


