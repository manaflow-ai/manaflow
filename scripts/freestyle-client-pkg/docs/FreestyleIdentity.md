# FreestyleIdentity


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 
**managed** | **bool** |  | 

## Example

```python
from freestyle_client.models.freestyle_identity import FreestyleIdentity

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleIdentity from a JSON string
freestyle_identity_instance = FreestyleIdentity.from_json(json)
# print the JSON string representation of the object
print(FreestyleIdentity.to_json())

# convert the object into a dict
freestyle_identity_dict = freestyle_identity_instance.to_dict()
# create an instance of FreestyleIdentity from a dict
freestyle_identity_from_dict = FreestyleIdentity.from_dict(freestyle_identity_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


